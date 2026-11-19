import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './tokens.css';
import './styles.css';
import './shell.css';
import './pieces.css';
import './briefing.css';
import './goals.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
