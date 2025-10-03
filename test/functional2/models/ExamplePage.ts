import { type Page } from '@playwright/test';

abstract class ExamplePage {
    readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    abstract goto(): Promise<void>;

    async waitUntilReady(): Promise<void> {
        await this.page.waitForFunction(() => window.view);
        await this.page.waitForFunction(() =>
            window.view.mainLoop.scheduler.commandsWaitingExecutionCount() === 0 &&
            window.view.mainLoop.renderingState === 0 &&
            window.view.getLayers().every((layer: any) => layer.ready),
        );
    }
}

export default ExamplePage;
