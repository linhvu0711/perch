import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost' });

interface TestGlobal {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}
(globalThis as TestGlobal).IS_REACT_ACT_ENVIRONMENT = true;
