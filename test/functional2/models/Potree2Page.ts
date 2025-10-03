import ExamplePage from './ExamplePage';

class Potree2Page extends ExamplePage {
    async goto() {
        await this.page.goto('examples/potree2_25d_map.html');
    }
}

export default Potree2Page;
