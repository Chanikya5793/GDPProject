import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AiProvider } from './context/AiContext'
import { SettingsProvider } from './context/SettingsContext'
import SidebarNav from './components/SidebarNav'
import AiSidebar from './components/AiSidebar'

// Pages
import Login     from './pages/Login'
import Dashboard from './pages/Dashboard'
import Calendar  from './pages/Calendar'
import Tasks     from './pages/Tasks'
import Reminders from './pages/Reminders'
import Notes     from './pages/Notes'
import Settings  from './pages/Settings'

// PRIVATE ROUTE
// Wraps all pages that requires login
// If not logged in, they will be redirected to /login instead
function PrivateRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

// APP LAYOUT
// Sidebar on the left, page content on the right
function AppLayout({ children }) {
  return (
    <div className="app-shell">
      <SidebarNav />
      <div className="main-content">
        <div className="beta-banner">
          <span>Beta</span>
          This is a demo version for testing purposes only — data is stored locally in your browser.
        </div>
        {children}
      </div>
      <AiSidebar />
    </div>
  )
}

// ROUTES
function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />

      <Route path="/" element={
        <PrivateRoute>
          <AppLayout>
            <Dashboard />
          </AppLayout>
        </PrivateRoute>
      }/>
      <Route path="/calendar" element={
        <PrivateRoute><AppLayout><Calendar /></AppLayout></PrivateRoute>
      }/>
      <Route path="/tasks" element={
        <PrivateRoute>
          <AppLayout>
            <Tasks />
          </AppLayout>
        </PrivateRoute>
      }/>
      <Route path="/reminders" element={
        <PrivateRoute>
          <AppLayout>
            <Reminders />
          </AppLayout>
        </PrivateRoute>
      }/>
      <Route path="/notes" element={
        <PrivateRoute>
          <AppLayout>
            <Notes />
          </AppLayout>
        </PrivateRoute>
      }/>
      <Route path="/settings" element={
        <PrivateRoute>
          <AppLayout>
            <Settings />
          </AppLayout>
        </PrivateRoute>
      }/>

      {/* If it doesn't exist, go back to dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <SettingsProvider>
      <AiProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </AiProvider>
    </SettingsProvider>
  )
}
