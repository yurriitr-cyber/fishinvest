import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import { applyLowPowerClass } from './lib/perf';
import { bootstrapTelegram } from './lib/telegram';

applyLowPowerClass();

bootstrapTelegram().finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
