import { SYSTEM_URLS } from '@/config/urls'

export async function verifyToken() {
  try {
    const authServerUrl = SYSTEM_URLS.USER_SYSTEM.BACKEND
    const verifyPath = '/protected'

    const response = await fetch(`${authServerUrl}${verifyPath}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    })

    return {
      status: response.status,
      isValid: response.status === 200
    }
  } catch (error) {
    console.error('Token verification error:', error)
    return {
      status: 500,
      isValid: false
    }
  }
} 