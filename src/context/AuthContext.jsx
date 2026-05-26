import { createContext, useContext, useState } from 'react'

// useAuth() hook to get the user

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // Check localStorage first so the user stays logged in after page refresh
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('nw_user')
    return stored ? JSON.parse(stored) : null
  })

  const login = async (email, password) => {
    // TODO: replace this with API call
    const mockUser = { id: 1, name: 'Bobby Bearcat', email }
    setUser(mockUser)
    localStorage.setItem('nw_user', JSON.stringify(mockUser))
    return { success: true }
  }

  const register = async (name, email, password) => {
    // TODO: replace this with API call
    const mockUser = { id: Date.now(), name, email }
    setUser(mockUser)
    localStorage.setItem('nw_user', JSON.stringify(mockUser))
    return { success: true }
  }

  const updateUser = (updates) => {
    const updated = { ...user, ...updates }
    setUser(updated)
    localStorage.setItem('nw_user', JSON.stringify(updated))
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('nw_user')
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// Call this to get { user, login, register, logout }
export function useAuth() {
  return useContext(AuthContext)
}
