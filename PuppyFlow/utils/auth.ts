import { SYSTEM_URLS } from '@/config/urls'

export async function verifyToken(token: string) {
  try {
    const authServerUrl = SYSTEM_URLS.USER_SYSTEM.BACKEND
    const verifyPath = '/protected'

    const response = await fetch(`${authServerUrl}${verifyPath}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
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