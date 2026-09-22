import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { warmUpApi } from './api/client'

// Before React has rendered anything. The API scales to zero, so this starts
// its container while the first paint and the Firebase handshake are still
// happening, and the first real request finds it already up.
warmUpApi()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
