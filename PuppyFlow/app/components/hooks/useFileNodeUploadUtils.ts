import React from 'react'
import { SYSTEM_URLS } from "@/config/urls";

export const PuppyStorage_IP_address_for_uploadingFile = `${SYSTEM_URLS.PUPPY_STORAGE.BASE}/generate_presigned_url`

function useFileNodeUploadUtils() {

    const onTriggerUploadFile = async (userId: string) => {
        const response = await fetch(`${PuppyStorage_IP_address_for_uploadingFile}/${userId}`)

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`)
        }

        const data = await response.json()
        console.log(data)
    }
    
  return (
    {onTriggerUploadFile}
  )
}

export default useFileNodeUploadUtils