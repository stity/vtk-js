import macro from 'vtk.js/Sources/macros';
import vtkCompositeMouseManipulator from 'vtk.js/Sources/Interaction/Manipulators/CompositeMouseManipulator';

// ----------------------------------------------------------------------------
// vtkMouseRangeManipulator methods
// ----------------------------------------------------------------------------

function vtkMouseRangeManipulator(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkMouseRangeManipulator');

  // Keep track of delta that is below the value
  // of one step to progressively increment it
  const incrementalDelta = new Map();

  // Internal methods
  //-------------------------------------------------------------------------
  function scaleDeltaToRange(listener, normalizedDelta) {
    return (
      normalizedDelta * ((listener.max - listener.min) / (listener.step + 1))
    );
  }

  //-------------------------------------------------------------------------
  function processDelta(listener, delta) {
    const oldValue = listener.getValue();

    // Apply scale and cached delta to current delta
    const newDelta = delta * listener.scale + incrementalDelta.get(listener);
    let value = oldValue + newDelta;

    // Compute new value based on step
    const difference = value - listener.min;
    const stepsToDifference = Math.round(difference / listener.step);
    value = listener.min + listener.step * stepsToDifference;
    value = Math.max(value, listener.min);
    value = Math.min(value, listener.max);

    if (value !== oldValue) {
      // Update value
      listener.setValue(value);
      incrementalDelta.set(listener, 0);
    } else if (
      (value === listener.min && newDelta < 0) ||
      (value === listener.max && newDelta > 0)
    ) {
      // Do not allow incremental delta to go past range
      incrementalDelta.set(listener, 0);
    } else {
      // Store delta for the next iteration
      incrementalDelta.set(listener, newDelta);
    }
  }

  // Public API methods

  // min:number = minimum allowable value
  // max:number = maximum allowable value
  // step:number = value per step -- smaller = more steps over a given distance, larger = fewer steps over a given distance
  // getValue:fn = function that returns current value
  // setValue:fn = function to set value
  // scale:number = scale value is applied to mouse event to allow users accelerate or decelerate delta without emitting more events
  //-------------------------------------------------------------------------
  publicAPI.setHorizontalListener = (
    min,
    max,
    step,
    getValue,
    setValue,
    scale = 1
  ) => {
    const getFn = Number.isFinite(getValue) ? () => getValue : getValue;
    model.horizontalListener = {
      min,
      max,
      step,
      getValue: getFn,
      setValue,
      scale,
    };
    incrementalDelta.set(model.horizontalListener, 0);
    publicAPI.modified();
  };

  //-------------------------------------------------------------------------
  publicAPI.setVerticalListener = (
    min,
    max,
    step,
    getValue,
    setValue,
    scale = 1
  ) => {
    const getFn = Number.isFinite(getValue) ? () => getValue : getValue;
    model.verticalListener = {
      min,
      max,
      step,
      getValue: getFn,
      setValue,
      scale,
    };
    incrementalDelta.set(model.verticalListener, 0);
    publicAPI.modified();
  };

  //-------------------------------------------------------------------------
  publicAPI.setScrollListener = (
    min,
    max,
    step,
    getValue,
    setValue,
    scale = 1
  ) => {
    const getFn = Number.isFinite(getValue) ? () => getValue : getValue;
    model.scrollListener = { min, max, step, getValue: getFn, setValue, scale };
    incrementalDelta.set(model.scrollListener, 0);
    publicAPI.modified();
  };

  //-------------------------------------------------------------------------
  publicAPI.removeHorizontalListener = () => {
    if (model.verticalListener) {
      incrementalDelta.delete(model.verticalListener);
      delete model.verticalListener;
      publicAPI.modified();
    }
  };

  //-------------------------------------------------------------------------
  publicAPI.removeVerticalListener = () => {
    if (model.horizontalListener) {
      incrementalDelta.delete(model.horizontalListener);
      delete model.horizontalListener;
      publicAPI.modified();
    }
  };

  //-------------------------------------------------------------------------
  publicAPI.removeScrollListener = () => {
    if (model.scrollListener) {
      incrementalDelta.delete(model.scrollListener);
      delete model.scrollListener;
      publicAPI.modified();
    }
  };

  //-------------------------------------------------------------------------
  publicAPI.removeAllListeners = () => {
    publicAPI.removeHorizontalListener();
    publicAPI.removeVerticalListener();
    publicAPI.removeScrollListener();
  };

  //-------------------------------------------------------------------------
  publicAPI.onButtonDown = (interactor, renderer, position) => {
    model.previousPosition = position;
    const glRenderWindow = interactor.getView();
    // Ratio is the dom size vs renderwindow size
    const ratio =
      glRenderWindow.getContainerSize()[0] / glRenderWindow.getSize()[0];
    // Get proper pixel range used by viewport in rw size space
    const size = glRenderWindow.getViewportSize(renderer);
    // rescale size to match mouse event position
    model.containerSize = size.map((v) => v * ratio);
  };

  publicAPI.onButtonUp = (interactor) => {
    interactor.exitPointerLock();
  };

  //--------------------------------------------------------------------------

  // TODO: at some point, this should perhaps be done in
  // RenderWindowInteractor instead of here.
  // We need to hook into mousemove directly for two reasons:
  // 1. We need to keep receiving mouse move events after the mouse button
  //    is released. This is currently not possible with
  //    vtkInteractorStyleManipulator.
  // 2. Since the mouse is stationary in pointer lock mode, we need the
  //    event.movementX and event.movementY info, which are not currently
  //    passed via interactor.onMouseMove.
  publicAPI.startPointerLockEvent = (interactor, renderer) => {
    const handlePointerLockMove = (event) => {
      publicAPI.onPointerLockMove(interactor, renderer, event);
    };

    document.addEventListener('mousemove', handlePointerLockMove);

    let subscription = null;
    const endInteraction = () => {
      document.removeEventListener('mousemove', handlePointerLockMove);
      subscription?.unsubscribe();
    };
    subscription = interactor?.onEndPointerLock(endInteraction);
  };

  publicAPI.onPointerLockMove = (interactor, renderer, event) => {
    // There is a slight delay between the `onEndPointerLock` call
    // and the last `onMouseMove` event, we must make sure the pointer
    // is still locked before we run this logic otherwise we may
    // get a `onMouseMove` call after the pointer has been unlocked.
    if (!interactor.isPointerLocked()) return;

    model.previousPosition.x += event.movementX;
    model.previousPosition.y += event.movementY;

    publicAPI.onMouseMove(interactor, renderer, model.previousPosition);
  };

  //-------------------------------------------------------------------------
  publicAPI.onMouseMove = (interactor, renderer, position) => {
    if (!model.verticalListener && !model.horizontalListener) {
      return;
    }

    // We only want to initialize the pointer lock listener
    // after the user starts moving their mouse, this way
    // we don't interfere with other events such as doubleClick,
    // for this reason we don't call this from `onButtonDown`
    if (model.usePointerLock && !interactor.isPointerLocked()) {
      interactor.requestPointerLock();
      publicAPI.startPointerLockEvent(interactor, renderer);
    }

    if (!position) {
      return;
    }

    if (model.horizontalListener) {
      const dxNorm =
        (position.x - model.previousPosition.x) / model.containerSize[0];
      const dx = scaleDeltaToRange(model.horizontalListener, dxNorm);
      processDelta(model.horizontalListener, dx);
    }
    if (model.verticalListener) {
      const dyNorm =
        (position.y - model.previousPosition.y) / model.containerSize[1];
      const dy = scaleDeltaToRange(model.verticalListener, dyNorm);
      processDelta(model.verticalListener, dy);
    }

    model.previousPosition = position;
  };

  //-------------------------------------------------------------------------
  publicAPI.onScroll = (interactor, renderer, delta) => {
    if (!model.scrollListener || !delta) {
      return;
    }
    processDelta(model.scrollListener, delta * model.scrollListener.step);
  };
  publicAPI.onStartScroll = publicAPI.onScroll;
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  horizontalListener: null,
  verticalListener: null,
  scrollListener: null,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  macro.obj(publicAPI, model);
  vtkCompositeMouseManipulator.extend(publicAPI, model, initialValues);

  // Create get-set macros
  macro.setGet(publicAPI, model, ['usePointerLock']);

  // Object specific methods
  vtkMouseRangeManipulator(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkMouseRangeManipulator'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
