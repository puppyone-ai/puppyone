import React from 'react'

function SkeletonLoadingIcon() {
  return (
    <div className="skeleton-container">
      <div className="skeleton-line w-[calc(100%-24px)]"></div>
      <div className="skeleton-line w-[calc(100%-48px)]"></div>
      <div className="skeleton-line w-[calc(100%-64px)]"></div>
    </div>
  )
}

export default SkeletonLoadingIcon