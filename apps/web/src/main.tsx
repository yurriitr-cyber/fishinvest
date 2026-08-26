import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';
import { bootstrapTelegram } from './lib/telegram';

bootstrapTelegram().finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
