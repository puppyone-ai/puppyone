import { generateReactHelpers } from '@uploadthing/react';
import type { OurFileRouter } from '@/app/api/uploadthing/core';
import {
  generateUploadButton,
  generateUploadDropzone,
} from '@uploadthing/react';

export const { useUploadThing, uploadFiles } =
  generateReactHelpers<OurFileRouter>();
export const UploadButton = generateUploadButton<OurFileRouter>();
export const UploadDropzone = generateUploadDropzone<OurFileRouter>();
