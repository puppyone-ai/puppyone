import React from 'react'

function SkeletonLoadingIcon() {
  return (
    <div className="skeleton-container">
      <div className="skeleton-line w-[60%]"></div>
      <div className="skeleton-line w-[100%]"></div>
      <div className="skeleton-line w-[80%]"></div>
    </div>
  )
}

export default SkeletonLoadingIcon