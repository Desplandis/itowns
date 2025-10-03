import { Page, expect } from '@playwright/test';

// Global types for iTowns
declare global {
  interface Window {
    view: any;
    itowns: any;
    THREE: any;
    debugMenu: any;
    minimap: any;
    navigation: any;
    searchbar: any;
    scale: any;
    cRL: any;
  }
}

export interface InitialPosition {
  coord?: {
    crs: string;
    x: number;
    y: number;
    z: number;
  };
  range?: number;
  tilt?: number;
  heading?: number;
}

export class ITownsTestHelper {
  constructor(private page: Page) {}

  /**
   * Load an iTowns example and wait for it to be ready
   */
  async loadExample(examplePath: string, screenshotName?: string): Promise<boolean> {
    const url = `http://localhost:8080/${examplePath}`;
    
    // Navigate to the example
    await this.page.goto(url);
    
    // Wait for page errors
    const pageErrors: Error[] = [];
    this.page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    // Wait for iTowns view to be available
    await this.page.waitForFunction(() => 
      typeof window.view === 'object' && window.view instanceof window.itowns.View
    );

    // Set default camera behavior
    await this.page.evaluate(() => {
      window.itowns.CameraUtils.defaultStopPlaceOnGroundAtEnd = true;
    });

    // Initialize layers
    try {
      await this.initializeLayers();
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        console.warn('*** Warning: initializeLayers timed out -> Camera motion had been stopped ***');
        await this.page.evaluate(() => {
          window.itowns.CameraUtils.stop(window.view, window.view.camera3D);
        });
        await this.initializeLayers();
      } else {
        throw e;
      }
    }

    // Wait for next render
    await this.waitNextRender();

    // Take screenshot if requested
    if (screenshotName && process.env.SCREENSHOT_FOLDER) {
      await this.saveScreenshot(screenshotName);
    }

    // Save initial position for restoration
    await this.saveInitialPosition();

    return true;
  }

  /**
   * Wait for all layers to be initialized and ready
   */
  async initializeLayers(timeout = 50000): Promise<void> {
    await this.page.waitForFunction(
      () => (
        window.view.mainLoop.scheduler.commandsWaitingExecutionCount() === 0 &&
        window.view.mainLoop.renderingState === 0 &&
        window.view.getLayers().every((layer: any) => layer.ready)
      ),
      { timeout }
    );
  }

  /**
   * Wait for the next render cycle
   */
  async waitNextRender(): Promise<void> {
    await this.page.evaluate(() => new Promise<void>((resolve) => {
      function resolveWhenDrawn() {
        window.view.removeFrameRequester(
          window.itowns.MAIN_LOOP_EVENTS.AFTER_RENDER, 
          resolveWhenDrawn
        );

        // Hide loading screen
        const container = document.getElementById('itowns-loader');
        if (container) {
          container.style.display = 'none';
        }
        
        // Hide scale widget
        const divScaleWidget = document.querySelectorAll('.divScaleWidget');
        if (divScaleWidget && divScaleWidget.length) {
          (divScaleWidget[0] as HTMLElement).style.display = 'none';
        }

        resolve();
      }
      
      window.view.addFrameRequester(
        window.itowns.MAIN_LOOP_EVENTS.AFTER_RENDER, 
        resolveWhenDrawn
      );
      window.view.notifyChange();
    }));
  }

  /**
   * Wait until iTowns is idle (no more commands in queue)
   */
  async waitUntilItownsIsIdle(screenshotName?: string): Promise<boolean> {
    const result = await this.page.evaluate(() => new Promise<boolean>((resolve) => {
      function resolveWhenReady() {
        if (window.view.mainLoop.renderingState === 0) {
          window.view.mainLoop.removeEventListener('command-queue-empty', resolveWhenReady);
          window.itowns.CameraUtils.stop(window.view, window.view.camera3D);
          resolve(true);
        }
      }
      window.view.mainLoop.addEventListener('command-queue-empty', resolveWhenReady);
    }));

    await this.waitNextRender();

    if (screenshotName && process.env.SCREENSHOT_FOLDER) {
      await this.saveScreenshot(screenshotName);
    }

    return result;
  }

  /**
   * Save a screenshot
   */
  async saveScreenshot(screenshotName: string): Promise<void> {
    if (process.env.SCREENSHOT_FOLDER && screenshotName) {
      const sanitized = screenshotName.replace(/[^\w_]/g, '_');
      const file = `${process.env.SCREENSHOT_FOLDER}/${sanitized}.png`;
      await this.page.screenshot({ path: file });
      console.log('Wrote', file);
    }
  }

  /**
   * Save initial camera position for restoration
   */
  async saveInitialPosition(): Promise<InitialPosition> {
    const position = await this.page.evaluate(() => {
      if (window.view.isGlobeView && window.view.controls) {
        return Promise.resolve(
          window.itowns.CameraUtils.getTransformCameraLookingAtTarget(
            window.view, 
            window.view.controls.camera
          )
        );
      } else if (window.view.isPlanarView) {
        // TODO: make the controls accessible from PlanarView
        return Promise.resolve({});
      }
      return {};
    });

    return position;
  }

  /**
   * Restore initial camera position
   */
  async restoreInitialPosition(initialPosition: InitialPosition): Promise<void> {
    await this.page.evaluate((init) => {
      if (window.view?.isGlobeView && window.view.controls && init.coord) {
        const coord = new window.itowns.Coordinates(
          init.coord.crs,
          init.coord.x,
          init.coord.y,
          init.coord.z,
        );
        window.view.controls.lookAtCoordinate(coord, false);
        window.view.notifyChange();
      } else if (window.view?.isPlanarView) {
        // TODO: make the controls accessible from PlanarView
      }
    }, initialPosition);

    // Reset mouse position
    await this.page.mouse.move(0, 0);
  }

  /**
   * Hide GUI elements for cleaner testing
   */
  async hideGUI(): Promise<void> {
    await this.page.evaluate(() => {
      if (window.debugMenu?.gui && window.cRL) {
        window.debugMenu.gui.remove(window.cRL);
      }
      if (window.minimap) window.minimap.hide();
      if (window.navigation) window.navigation.hide();
      if (window.searchbar) window.searchbar.hide();
      if (window.scale) window.scale.hide();
    });
  }

  /**
   * Get the center coordinates of the viewport
   */
  async getViewportCenter(): Promise<{ x: number; y: number }> {
    const viewport = this.page.viewportSize();
    return {
      x: viewport!.width / 2,
      y: viewport!.height / 2
    };
  }

  /**
   * Perform mouse drag operation
   */
  async mouseDrag(
    startX: number, 
    startY: number, 
    endX: number, 
    endY: number, 
    steps = 20
  ): Promise<void> {
    await this.page.mouse.move(startX, startY, { steps });
    await this.page.mouse.down();
    await this.page.mouse.move(endX, endY, { steps });
    await this.page.mouse.up();
  }

  /**
   * Perform mouse wheel operation
   */
  async mouseWheel(deltaY: number): Promise<void> {
    await this.page.evaluate((delta) => {
      const wheelEvent = new WheelEvent('wheel', { deltaY: delta });
      window.view.domElement.dispatchEvent(wheelEvent);
      window.dispatchEvent(wheelEvent);
    }, deltaY);
  }
}
