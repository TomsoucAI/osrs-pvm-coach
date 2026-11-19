import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './tokens.css';
import './styles.css';
import './shell.css';
import './pieces.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
