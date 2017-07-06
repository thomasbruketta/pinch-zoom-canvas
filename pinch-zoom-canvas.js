(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define(["impetus"], function (Impetus) {
      return (root.PinchZoomCanvas = factory(Impetus))
    })
  } else if (typeof module === "object" && module.exports) {
    module.exports = (root.PinchZoomCanvas = factory(require("impetus")))
  } else {
    root.PinchZoomCanvas = factory(root.Impetus)
  }
}(this, function (Impetus) {
  var PinchZoomCanvas = function (options) {
    if (!options || !options.canvas || !options.path) {
      throw 'PinchZoomCanvas constructor: missing arguments canvas or path'
    }

    // Check if exists function requestAnimationFrame
    this._checkRequestAnimationFrame()

    var clientWidth = window.innerWidth
    var clientHeight = window.innerHeight

    this.doubletap = typeof options.doubletap == 'undefined' ? true : options.doubletap
    this.momentum = options.momentum
    this.canvas = options.canvas
    this.canvas.width = clientWidth * 2 // twice the client width
    this.canvas.height = clientHeight * 2 // twice the client height
    this.canvas.style.width = clientWidth + 'px'
    this.canvas.style.height = clientHeight + 'px'
    this.context = this.canvas.getContext('2d')
    this.maxZoom = (options.maxZoom || 2)
    this.onZoomEnd = options.onZoomEnd // Callback of zoom end
    this.onZoom = options.onZoom // Callback on zoom
    this.onClose = options.onClose // Callback of zoom end
    this.initResizeProperty = null
    this.threshold = options.threshold || 40
    this.startingZoom = options.startingZoom || 1
    this.fullScreen = options.fullScreen || false
    this.animateFromY = options.animateFromY * 2

    // Init
    this.position = {
      x: 0,
      y: 0,
    }
    this.scale = {
      x: 1,
      y: 1,
    }
    this.initPosition = {
      x: 0,
      y: 0,
    }
    this.offset = {
      x: 0,
      y: 0,
    }

    this.initialScale = null
    this.boundX = null
    this.boundY = null

    this.lastZoomScale = null // what was the last scale?
    this.lastX = null // what was the last x position?
    this.lastY = null // what was the last y position?
    this.lastP1 = null
    this.lastP2 = null
    this.startZoom = false // has zoom started?
    this.init = false // are we initialized?
    this.running = true // are we actively tracking?
    this.zoomed = false // are we zoomed in?
    this.animating = false // are we animating at all?
    // this.animatingZoom = false // are we animating at all?
    this.isZoomedPastMin = false // are we zoomed past our minimum scale?
    this.isZoomedPastMax = false // are we zoomed past our maximum scale?
    this.shouldTapClose = false // is a tap?

    // Bind events
    this.onTouchStart = this.onTouchStart.bind(this)
    this.onTouchMove = this.onTouchMove.bind(this)
    this.onTouchEnd = this.onTouchEnd.bind(this)
    this.animateTo = this.animateTo.bind(this)
    // this.animateZoom = this.animateZoom.bind(this)
    this._getPositionValues = this._getPositionValues.bind(this)
    this.render = this.render.bind(this)
    this.closeAnimation = this.closeAnimation.bind(this)

    this.currentIterationTime = 0
    this.startTime = null

    // Load the image or use cachedImage
    if (options.cachedImage) {
      this.imgTexture = options.cachedImage
      requestAnimationFrame(this.render)
      this._setEventListeners()
    }
    else {
      this.imgTexture = new Image()

      this.imgTexture.onload = function () {
        requestAnimationFrame(this.render)
        this._setEventListeners()
      }.bind(this)

      this.imgTexture.src = options.path
    }
  }

  PinchZoomCanvas.prototype = {
    // Render method. It starts in infinite loop in each requestAnimationFrame of the browser.
    render: function () {
      // don't render if we're paused or not initialized
      if (this.init && !this.running) return this

      //set initial scale such as image cover all the canvas
      if (!this.init) {
        if (this.imgTexture.width) {
          console.log('canvas', this.canvas.width, this.canvas.height)

          var viewportRatio = this.canvas.width / this.canvas.height
          var imageRatio = this.imgTexture.width / this.imgTexture.height
          var scaleRatio = null

          if (imageRatio >= viewportRatio) { // wide image
            this.initResizeProperty = 'width'
            scaleRatio = this.canvas.width / this.imgTexture.width * this.startingZoom // startingZoom multiplier
          } else if (imageRatio < viewportRatio) { // tall image
            this.initResizeProperty = 'height'
            scaleRatio = this.canvas.height / this.imgTexture.height * this.startingZoom // startingZoom multiplier
          }

          this.position.x = (this.canvas.width - this.imgTexture.width * scaleRatio) / 2 // center horizontal
          this.position.y = (this.canvas.height - this.imgTexture.height * scaleRatio) / 2 // center vertical

          // scale x and y to init scaleRatio calculation
          this.scale.x = scaleRatio
          this.scale.y = scaleRatio

          // initial position is centered in the canvas
          this.initPosition = {
            x: this.position.x,
            y: this.position.y
          }

          // the initial scale is the scaling ratio
          this.initialScale = scaleRatio // includes the startingZoom
          this.calculateOffset()

          this.minZoom = this.initialScale

          // start the impetus so we can move things right away if using momentum
          if (this.momentum) {
            if (this.animateFromY) {
              // need to break out into separate functions!!!!!
              var currentImageWidth = this.imgTexture.width * scaleRatio // getCurrentWidth()
              var currentImageHeight = this.imgTexture.height * scaleRatio // getCurrentHeight()
              var scale = (this.canvas.height + 4) / currentImageHeight // scale needed to animate image height to canvas height + 4 (buffer)

              // get the offset needed to keep image centered while scaling:
              var scalePositionXOffset = ((currentImageWidth * scale) - currentImageWidth) / 2 // getDeltaPositionX()
              var scalePositionYOffset = ((currentImageHeight * scale) - currentImageHeight) / 2 // getDeltaPositionY()

              var fromX = this.initPosition.x
              var toX = this.initPosition.x - scalePositionXOffset

              var fromY = this.animateFromY
              var toY = this.position.y - scalePositionYOffset

              var fromZoom = this.initialScale
              var toZoom = this.initialScale * scale


              this.minZoom = toZoom
              this.initialPositionX = toX // need better names
              this.initialPositionY = toY // for these variables (animated initial positions? min zoom positions? )

              // set y to starting position
              this.position.y = this.animateFromY

              // let everyone know we're animating
              this.animating = true

              this.animateTo(fromZoom, toZoom, fromX, toX, fromY, toY, 400, this._createImpetus)
            }
            else {
              this._createImpetus()
            }
          }

          this.init = true // done initializing!
        }
      }
      // erases the canvas
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)

      // draws the image position and scale
      this.context.drawImage(
        this.imgTexture,
        this.position.x, this.position.y,
        this.scale.x * this.imgTexture.width,
        this.scale.y * this.imgTexture.height
      )
      requestAnimationFrame(this.render)
    },

    pause: function () {
      this.running = false
      return this
    },

    resume: function () {
      this.calculateOffset()
      this.running = true
      requestAnimationFrame(this.render)
      return this
    },

		/**
		 * Calculates the offset of the canvas position relative to the page
     * since touch events are always relative to the page
		 */
    calculateOffset: function () {
      if (!this.canvas) return this

      // no offset if we're using direct client coordinates (full screen canvas)
      if (!this.fullScreen) {
        const canvasBox = this.canvas.getBoundingClientRect()

        // caculate the offset from the scroll position
        this.offset.x = canvasBox.left + window.scrollX
        this.offset.y = canvasBox.top + window.scrollY
      }

      return this
    },

    /**
     * handles zooming in and out
     */
    zoom: function (zoom, touchX, touchY) {
      if (!zoom || this.animating || !this.init) {
        return
      }

      //new scale
      var currentScale = this.scale.x
      var newScale = currentScale + zoom / 100

      // TODO: Make bounceback on zoomed to in or out instead of hard setting
      if (newScale < this.minZoom && zoom < 0) { // we are below the minimum zoom (initialZoom)
        this.zoomed = false // we're back at the initial scale
        var resistance = (currentScale + this.minZoom) * 10
        newScale = this.scale.x + zoom / (100 * resistance)
      } else if (this.maxZoom && newScale > this.maxZoom && zoom > 0) { // we are above maximum zoom
        this.zoomed = true
      } else { // we are zoomed in between min and max
        this.zoomed = true
      }

      var deltaScale = newScale - currentScale

      var positionValues = this._getPositionValues(touchX, touchY, deltaScale)

      //finally affectations
      this.scale.x = newScale
      this.scale.y = newScale
      this.position.x += positionValues.x
      this.position.y += positionValues.y

      // onZoom callback
      if (this.onZoom) {
        this.onZoom(newScale, this.zoomed)
      }
    },

    _getPositionValues: function (touchX, touchY, deltaScale) {
      var currentWidth = this.imgTexture.width * this.scale.x
      var currentHeight = this.imgTexture.height * this.scale.y
      var deltaWidth = this.imgTexture.width * deltaScale
      var deltaHeight = this.imgTexture.height * deltaScale

      var tX = (touchX * 2 - this.position.x)
      var tY = (touchY * 2 - this.position.y)

      var pX = -tX / currentWidth
      var pY = -tY / currentHeight

      return {
        x: pX * deltaWidth,
        y: pY * deltaHeight,
      }
    },

    animateTo: function (startScale, endScale, startX, endX, startY, endY, duration, callback) {
      if (!this.startTime) {
        this.startTime = performance.now()
        this.currentIterationTime = 0
      }
      else {
        this.currentIterationTime = performance.now() - this.startTime
      }

      if (this.currentIterationTime > duration) {
        this.scale.x = endScale
        this.scale.y = endScale
        this.position.x = endX
        this.position.y = endY
        this.animating = false
        // reset startTime for next animation
        this.startTime = null
        if (typeof callback === 'function') {
          callback.call(this)
        }
        return
      }

      var scale = this._easeInOutQuad(this.currentIterationTime, startScale, endScale - startScale, duration)
      var x = this._easeInOutQuad(this.currentIterationTime, startX, endX - startX, duration)
      var y = this._easeInOutQuad(this.currentIterationTime, startY, endY - startY, duration)

      this.scale.x = scale
      this.scale.y = scale
      this.position.x = x
      this.position.y = y

      requestAnimationFrame(this.animateTo.bind(this, startScale, endScale, startX, endX, startY, endY, duration, callback))
    },

    move: function (relativeX, relativeY) {
      if (!this.init || this.animating) {
        return
      }

      if (!this.momentum && this.lastX && this.lastY) {
        var deltaX = relativeX - this.lastX
        var deltaY = relativeY - this.lastY
        var currentWidth = (this.imgTexture.width * this.scale.x)
        var currentHeight = (this.imgTexture.height * this.scale.y)

        var clientWidth = this.canvas.width, clientHeight = this.canvas.height

        this.position.x += deltaX
        this.position.y += deltaY


        //edge cases
        if (currentWidth >= clientWidth) {
          if (this.position.x > 0) {
            // cannot move left edge of image > container left edge
            this.position.x = 0
          } else if (this.position.x + currentWidth < clientWidth) {
            // cannot move right edge of image < container right edge
            this.position.x = clientWidth - currentWidth
          }
        } else {
          if (this.position.x < currentWidth - clientWidth) {
            // cannot move left edge of image < container left edge
            this.position.x = currentWidth - clientWidth
          } else if (this.position.x > clientWidth - currentWidth) {
            // cannot move right edge of image > container right edge
            this.position.x = clientWidth - currentWidth
          }
        }
        if (currentHeight > clientHeight) {
          if (this.position.y > 0) {
            // cannot move top edge of image < container top edge
            this.position.y = 0
          } else if (this.position.y + currentHeight < clientHeight) {
            // cannot move bottom edge of image > container bottom edge
            this.position.y = clientHeight - currentHeight
          }
        } else {
          if (this.position.y < 0) {
            // cannot move top edge of image < container top edge
            this.position.y = 0
          } else if (this.position.y > clientHeight - currentHeight) {
            // cannot move bottom edge of image > container bottom edge
            this.position.y = clientHeight - currentHeight
          }
        }
      } else if (this.momentum && this.lastX && this.lastY) {
        // check if we're within a pixel of x,y and if so we set position
        // to the whole pixel values so that we don't have infinite "wiggle"

        var thresholdX = Math.round(this.lastX) === Math.round(relativeX)
        var thresholdY = Math.round(this.lastY) === Math.round(relativeY)

        if (this.impetus && thresholdX && thresholdY) {
          this.position.x = this.lastX = Math.round(relativeX)
          this.position.y = this.lastY = Math.round(relativeY)
        } else {
          this.position.x = relativeX
          this.position.y = relativeY
        }
      }

      this.lastX = relativeX
      this.lastY = relativeY
    },

    isZoomed: function () {
      return this.zoomed
    },

    destroy: function () {
      this.pause()
      this._removeEventListeners()
      this._destroyImpetus()
      this.imgTexture = null
      this.canvas = null
      // this.init = false
    },

    closeAnimation: function () {
      this._destroyImpetus()

      this.animating = true

      var startScale = this.scale.x
      var endScale = this.initialScale

      var startX = this.position.x
      var endX = this.initPosition.x

      var startY = this.position.y
      var endY = this.animateFromY

      this.animateTo(startScale, endScale, startX, endX, startY, endY, 400)

      this.onClose()
    },

    //
    // Private
    //

    /**
     * takes a touchPoint and returns an object with the x,y values based on
     * if we're full screen or not
     */
    _getTouch: function (touchPoint) {
      var point

      if (this.fullScreen) {
        point = { x: touchPoint.clientX, y: touchPoint.clientY }
      } else {
        point = { x: touchPoint.pageX, y: touchPoint.pageY }
      }
      return point
    },

    _gesturePinchZoom: function (event) {
      var zoom = false

      if (event.targetTouches.length >= 2) {
        var p1 = this._getTouch(event.targetTouches[0])
        var p2 = this._getTouch(event.targetTouches[1])
        var zoomScale = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) // euclidian distance

        if (p1) {
          this.lastP1 = p1
        }

        if (p2) {
          this.lastP2 = p2
        }

        if (this.lastZoomScale) {
          zoom = zoomScale - this.lastZoomScale
        }

        this.lastZoomScale = zoomScale
      }
      return zoom
    },

    _checkRequestAnimationFrame: function () {
      if (window.requestAnimationFrame)
        return this

      var lastTime = 0
      var vendors = ['ms', 'moz', 'webkit', 'o']
      for (var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame']
        window.cancelAnimationFrame =
          window[vendors[x] + 'CancelAnimationFrame'] || window[vendors[x] + 'CancelRequestAnimationFrame']
      }

      if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = function (callback, element) {
          var currTime = new Date().getTime()
          var timeToCall = Math.max(0, 16 - (currTime - lastTime))
          var id = window.setTimeout(function () { callback(currTime + timeToCall) },
            timeToCall)
          lastTime = currTime + timeToCall
          return id
        }
      }

      if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = function (id) {
          clearTimeout(id)
        }
      }
      return this
    },


    _createImpetus: function () {
      if (typeof Impetus === 'undefined' || !this.momentum || this.impetus) {
        return
      }

      var boundX, boundY

      // setting bounds
      if (this.initResizeProperty == 'width') {
        boundX = [-this.imgTexture.width * this.scale.x + this.canvas.width, 0]
        if (this.imgTexture.height * this.scale.y > this.canvas.height) {
          boundY = [-this.imgTexture.height * this.scale.y + this.canvas.height, 0]
        }
        else {
          boundY = [this.boundY - 1, this.boundY + 1]
        }
      }
      else {
        if (this.imgTexture.width * this.scale.x > this.canvas.width) {
          boundX = [-this.imgTexture.width * this.scale.x + this.canvas.width, 0]
        }
        else {
          boundX = [this.boundX - 1, this.boundX + 1]
        }
        boundY = [-this.imgTexture.height * this.scale.y + this.canvas.height, 0]
      }

      // Impetus hack, so it actually stays within boundaries
      boundX[0] += 2
      boundX[1] -= 2
      boundY[0] += 2

      this.impetus = new Impetus({
        source: this.canvas,
        boundX: boundX,
        boundY: boundY,
        initialValues: [this.position.x, this.position.y],
        friction: 0.96,
        multiplier: 2,
        update: function (x, y) {
          this.move(x, y)
        }.bind(this)
      })

    },

    _destroyImpetus: function () {
      if (this.impetus && this.impetus.destroy) {
        this.impetus = this.impetus.destroy()
      }
    },

    _setEventListeners: function () {
      this.canvas.addEventListener('touchstart', this.onTouchStart)
      this.canvas.addEventListener('touchmove', this.onTouchMove)
      this.canvas.addEventListener('touchend', this.onTouchEnd)
      return this
    },

    _removeEventListeners: function () {
      this.canvas.removeEventListener('touchstart', this.onTouchStart)
      this.canvas.removeEventListener('touchmove', this.onTouchMove)
      this.canvas.removeEventListener('touchend', this.onTouchEnd)
      return this
    },

    _easeInOutQuad: function (currentIteration, startValue, changeInValue, totalIterations) {
      if ((currentIteration /= totalIterations / 2) < 1) {
        return changeInValue / 2 * currentIteration * currentIteration + startValue;
      }
      return -changeInValue / 2 * ((--currentIteration) * (currentIteration - 2) - 1) + startValue;
    },

    //
    // Events
    //

    onTouchStart: function (e) {
      this.lastX = null
      this.lastY = null
      this.lastZoomScale = null
      this.shouldTapClose = true
    },

    onTouchMove: function (e) {
      if (this.shouldTapClose)
        this.shouldTapClose = false

      if (this.zoomed)
        e.preventDefault() //block event propagation

      var p1 = this._getTouch(e.targetTouches[0])

      if (e.targetTouches.length == 2) { // pinch
        var p2 = this._getTouch(e.targetTouches[1])

        this.startZoom = true
        if (this.momentum)
          this._destroyImpetus()

        var x = (p1.x + p2.x) / 2
        var y = (p1.y + p2.y) / 2
        this.zoom(this._gesturePinchZoom(e), x, y)
      }
      else if (e.targetTouches.length == 1) { // non momentum based movement
        if (this.momentum) {
          this._createImpetus()
        } else {
          var relativeX = p1.x - this.offset.x
          var relativeY = p1.y - this.offset.y
          this.move(relativeX, relativeY)
        }
      }

    },

    onTouchEnd: function (e) {
      // Check if touchend
      if (this.shouldTapClose && typeof this.onClose === 'function' && !this.animating) {
        this.closeAnimation()
        return
      }

      // FIXME: Double tap doesn't yield correct results overall
      // handle double-tap
      if (this.doubletap && !this.startZoom && e.changedTouches.length > 0) {
        var touch = this._getTouch(e.changedTouches[0])
        var distance = touch.x - (this.lastTouchX || 0)
        var now = new Date().getTime()
        var lastTouch = this.lastTouchTime || now + 1 /** the first time this will make delta a negative number */
        var delta = now - lastTouch

        // doubletap is an actual double-tap
        if (distance >= 0 && distance < this.threshold && delta > 0 && delta < 500) {
          this.lastTouchTime = null
          this.lastTouchX = 0
          this.startZoom = true
          if (this.zoomed) {
            // FIXME: This needs to reset to initial view
            this.zoom(-400, this.boundX, this.boundY) // FIXME: breaks bounding
          } else {
            // FIXME: This needs max out view according to maxScale
            this.zoom(this.maxZoom * 1000, touch.x - this.offset.x, touch.y - this.offset.y)
          }
        } else {
          this.lastTouchTime = now
          this.lastTouchX = touch.x
        }
      } else {
        this.lastTouchTime = null
        this.lastTouchX = 0
      }

      // resume impetus if applicable
      if (this.momentum) {
        e.preventDefault()
        // if we're zooming
        if (this.startZoom && this.zoomed) {
          this._createImpetus()
        } else if (!this.zoomed && !this.momentum) { // no momentum and at initial scale otherwise we keep impetus alive to move things around
          this._destroyImpetus()
        }
      }

      var isZoomedPastMin = Math.round(this.scale.x * 100) / 100 < Math.round(this.minZoom * 100) / 100
      var isZoomedPastMax = Math.round(this.scale.x * 100) / 100 > Math.round(this.maxZoom * 100) / 100

      var positionX
      var positionY

      if (isZoomedPastMin || isZoomedPastMax) {
        var zoomToValue

        if (isZoomedPastMax) {
          zoomToValue = Math.round(this.maxZoom * 100) / 100

          var deltaScale = zoomToValue - this.scale.x

          var p1 = this._getTouch(e.changedTouches[0])
          var p2 = e.changedTouches[1] && this._getTouch(e.changedTouches[1])

          if (!p2) {
            p1 = this.lastP1
            p2 = this.lastP2
          }

          var lastTouchX = p2 ? (p1.x + p2.x) / 2 : p1.x
          var lastTouchY = p2 ? (p1.y + p2.y) / 2 : p1.y

          var positionValues = this._getPositionValues(lastTouchX, lastTouchY, deltaScale)

          positionX = this.position.x + positionValues.x
          positionY = this.position.y + positionValues.y
        }
        else if (isZoomedPastMin) {
          zoomToValue = Math.round(this.minZoom * 100) / 100
          positionX = this.initialPositionX
          positionY = this.initialPositionY
        }

        if (this.momentum && this.impetus) {
          this._destroyImpetus()
        }

        var duration = 300

        if (!this.animating) {
          this.animating = true
          this.animateTo(this.scale.x, zoomToValue, this.position.x, positionX, this.position.y, positionY, duration, this._createImpetus)
        }
      }

      // onZoomEnd callback
      if (this.startZoom && typeof this.onZoomEnd === 'function')
        this.onZoomEnd(Math.round(this.scale.x * 100) / 100, this.zoomed)

      this.startZoom = false // we're done zooming
    }
  }

  return PinchZoomCanvas

}))
