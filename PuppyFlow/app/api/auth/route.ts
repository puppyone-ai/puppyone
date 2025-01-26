import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/utils/auth'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return NextResponse.json({ error: 'No token provided' }, { status: 400 })
  }

  const { status, isValid } = await verifyToken(token)
  
  if (isValid) {
    return NextResponse.json({ message: 'Token verified successfully' }, { status: 200 })
  }

  const statusMessages: Record<number, string> = {
    801: 'Invalid token',
    804: 'User data not found',
  }

  const error = statusMessages[status] || 'Authentication failed'
  return NextResponse.json({ error }, { status })
}
