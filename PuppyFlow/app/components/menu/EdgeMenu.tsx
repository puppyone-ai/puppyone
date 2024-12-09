import React, { useEffect } from 'react'

type edgeMenuProps = {
  selectedMenu: number,
  nodeType: string,
}

function EdgeMenu({selectedMenu, nodeType}: edgeMenuProps) {

  if (nodeType === 'LLM') {
    return (
      <ul id="edgeMenu" className={`w-[127px]  ${selectedMenu === 1 ? "h-[129px]" : "h-0 border-y-0"} bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#6D7177] absolute top-[-22px] left-[48px] flex flex-col justify-evenly z-[20001] items-center ${selectedMenu === 1 ? "" : "hidden"}`} >
      <li className='w-[110px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer'>
          <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <g clipPath="url(#clip0_1868_240)">
              <mask id="mask0_1868_240" style={{maskType:"luminance"}} maskUnits="userSpaceOnUse" x="0" y="0" width="12" height="12">
                <path d="M12 0H0V12H12V0Z" fill="white"/>
              </mask>
              <g mask="url(#mask0_1868_240)">
                <path d="M11.1397 4.91143C11.412 4.0943 11.3182 3.19918 10.8828 2.45593C10.2281 1.31593 8.91184 0.72943 7.62634 1.00543C7.05447 0.361181 6.23284 -0.00519436 5.37147 5.5659e-05C4.05747 -0.00294434 2.89159 0.843055 2.48734 2.0933C1.64322 2.26618 0.914592 2.79455 0.488217 3.54343C-0.171409 4.68043 -0.0210335 6.11368 0.860217 7.08868C0.587967 7.9058 0.681717 8.80093 1.11709 9.54418C1.77184 10.6842 3.08809 11.2707 4.37359 10.9947C4.94509 11.6389 5.76709 12.0053 6.62847 11.9997C7.94322 12.0031 9.10947 11.1563 9.51372 9.90493C10.3578 9.73205 11.0865 9.20368 11.5128 8.4548C12.1717 7.3178 12.021 5.88568 11.1401 4.91068L11.1397 4.91143ZM6.62922 11.2156C6.10309 11.2163 5.59347 11.0322 5.18959 10.6951C5.20797 10.6853 5.23984 10.6677 5.26047 10.6549L7.64997 9.27493C7.77222 9.20555 7.84722 9.07543 7.84647 8.9348V5.56618L8.85634 6.1493C8.86722 6.15455 8.87434 6.16505 8.87584 6.17705V8.96668C8.87434 10.2072 7.86972 11.2129 6.62922 11.2156ZM1.79772 9.15193C1.53409 8.69668 1.43922 8.16305 1.52959 7.64518C1.54722 7.65568 1.57834 7.6748 1.60047 7.68755L3.98997 9.06755C4.11109 9.13843 4.26109 9.13843 4.38259 9.06755L7.29972 7.38305V8.5493C7.30047 8.5613 7.29484 8.57293 7.28547 8.58043L4.87009 9.97505C3.79422 10.5946 2.42022 10.2263 1.79809 9.15193H1.79772ZM1.16884 3.93605C1.43134 3.48005 1.84572 3.1313 2.33922 2.95018C2.33922 2.9708 2.33809 3.00718 2.33809 3.03268V5.79305C2.33734 5.9333 2.41234 6.06343 2.53422 6.1328L5.45134 7.81693L4.44147 8.40005C4.43134 8.4068 4.41859 8.40793 4.40734 8.40305L1.99159 7.0073C0.917967 6.38555 0.549717 5.01193 1.16847 3.93643L1.16884 3.93605ZM9.46609 5.86693L6.54897 4.18243L7.55884 3.59968C7.56897 3.59293 7.58172 3.5918 7.59297 3.59668L10.0087 4.9913C11.0842 5.61268 11.4528 6.98855 10.8315 8.06405C10.5686 8.5193 10.1546 8.86805 9.66147 9.04955V6.20668C9.66259 6.06643 9.58797 5.93668 9.46647 5.86693H9.46609ZM10.4711 4.35418C10.4535 4.3433 10.4223 4.32455 10.4002 4.3118L8.01072 2.9318C7.88959 2.86093 7.73959 2.86093 7.61809 2.9318L4.70097 4.6163V3.45005C4.70022 3.43805 4.70584 3.42643 4.71522 3.41893L7.13059 2.02543C8.20647 1.4048 9.58197 1.77418 10.2022 2.85043C10.4643 3.30493 10.5592 3.83705 10.4703 4.35418H10.4711ZM4.15197 6.4328L3.14172 5.84968C3.13084 5.84443 3.12372 5.83393 3.12222 5.82193V3.0323C3.12297 1.7903 4.13059 0.783805 5.37259 0.784555C5.89797 0.784555 6.40647 0.969055 6.81034 1.30505C6.79197 1.3148 6.76047 1.33243 6.73947 1.34518L4.34997 2.72518C4.22772 2.79455 4.15272 2.9243 4.15347 3.06493L4.15197 6.43205V6.4328ZM4.70059 5.25005L5.99997 4.49968L7.29934 5.24968V6.75005L5.99997 7.50005L4.70059 6.75005V5.25005Z" fill="white"/>
              </g>
            </g>
            <defs>
              <clipPath id="clip0_1868_240">
                <rect width="12" height="12" fill="white"/>
              </clipPath>
            </defs>
          </svg>
          </div>
          <div className='text-[12px] font-[700] flex items-center justify-center h-full'>LLM</div>
      </li> 
      <li className='w-[110px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer'>
          <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="10" viewBox="0 0 18 10" fill="none">
          <mask id="path-1-inside-1_1868_291" fill="white">
            <path d="M11 0H18V4H11V0Z"/>
          </mask>
          <path d="M11 0H18V4H11V0Z" fill="#1C1D1F"/>
          <path d="M11 0V-1H9.5V0H11ZM18 0H19.5V-1H18V0ZM18 4V5H19.5V4H18ZM11 4H9.5V5H11V4ZM11 1H18V-1H11V1ZM16.5 0V4H19.5V0H16.5ZM18 3H11V5H18V3ZM12.5 4V0H9.5V4H12.5Z" fill="#CDCDCD" mask="url(#path-1-inside-1_1868_291)"/>
          <mask id="path-3-inside-2_1868_291" fill="white">
            <path d="M11 3H18V7H11V3Z"/>
          </mask>
          <path d="M11 3H18V7H11V3Z" fill="#1C1D1F"/>
          <path d="M11 3V2H9.5V3H11ZM18 3H19.5V2H18V3ZM18 7V8H19.5V7H18ZM11 7H9.5V8H11V7ZM11 4H18V2H11V4ZM16.5 3V7H19.5V3H16.5ZM18 6H11V8H18V6ZM12.5 7V3H9.5V7H12.5Z" fill="#CDCDCD" mask="url(#path-3-inside-2_1868_291)"/>
          <mask id="path-5-inside-3_1868_291" fill="white">
            <path d="M11 6H18V10H11V6Z"/>
          </mask>
          <path d="M11 6H18V10H11V6Z" fill="#1C1D1F"/>
          <path d="M11 6V5H9.5V6H11ZM18 6H19.5V5H18V6ZM18 10V11H19.5V10H18ZM11 10H9.5V11H11V10ZM11 7H18V5H11V7ZM16.5 6V10H19.5V6H16.5ZM18 9H11V11H18V9ZM12.5 10V6H9.5V10H12.5Z" fill="#CDCDCD" mask="url(#path-5-inside-3_1868_291)"/>
          <line x1="7" y1="4.5" x2="11" y2="4.5" stroke="#6D7177"/>
          <rect x="0.5" y="0.5" width="6" height="9" fill="#1C1D1F" stroke="#CDCDCD"/>
        </svg>
          </div>
          <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Churking</div>
      </li> 
      <li className='w-[110px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer'>
          <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="10" viewBox="0 0 18 10" fill="none">
            <line x1="7" y1="2.5" x2="11" y2="2.5" stroke="#6D7177"/>
            <mask id="path-2-inside-1_1868_300" fill="white">
              <path d="M0 0H7V4H0V0Z"/>
            </mask>
            <path d="M0 0H7V4H0V0Z" fill="#1C1D1F"/>
            <path d="M0 0V-1H-1.5V0H0ZM7 0H8.5V-1H7V0ZM7 4V5H8.5V4H7ZM0 4H-1.5V5H0V4ZM0 1H7V-1H0V1ZM5.5 0V4H8.5V0H5.5ZM7 3H0V5H7V3ZM1.5 4V0H-1.5V4H1.5Z" fill="#CDCDCD" mask="url(#path-2-inside-1_1868_300)"/>
            <mask id="path-4-inside-2_1868_300" fill="white">
              <path d="M0 3H7V7H0V3Z"/>
            </mask>
            <path d="M0 3H7V7H0V3Z" fill="#1C1D1F"/>
            <path d="M0 3V2H-1.5V3H0ZM7 3H8.5V2H7V3ZM7 7V8H8.5V7H7ZM0 7H-1.5V8H0V7ZM0 4H7V2H0V4ZM5.5 3V7H8.5V3H5.5ZM7 6H0V8H7V6ZM1.5 7V3H-1.5V7H1.5Z" fill="#CDCDCD" mask="url(#path-4-inside-2_1868_300)"/>
            <mask id="path-6-inside-3_1868_300" fill="white">
              <path d="M11 0H18V4H11V0Z"/>
            </mask>
            <path d="M11 0H18V4H11V0Z" fill="#1C1D1F"/>
            <path d="M11 0V-1H9.5V0H11ZM18 0H19.5V-1H18V0ZM18 4V5H19.5V4H18ZM11 4H9.5V5H11V4ZM11 1H18V-1H11V1ZM16.5 0V4H19.5V0H16.5ZM18 3H11V5H18V3ZM12.5 4V0H9.5V4H12.5Z" fill="#CDCDCD" mask="url(#path-6-inside-3_1868_300)"/>
            <mask id="path-8-inside-4_1868_300" fill="white">
              <path d="M0 6H7V10H0V6Z"/>
            </mask>
            <path d="M0 6H7V10H0V6Z" fill="#1C1D1F"/>
            <path d="M0 6V5H-1.5V6H0ZM7 6H8.5V5H7V6ZM7 10V11H8.5V10H7ZM0 10H-1.5V11H0V10ZM0 7H7V5H0V7ZM5.5 6V10H8.5V6H5.5ZM7 9H0V11H7V9ZM1.5 10V6H-1.5V10H1.5Z" fill="#CDCDCD" mask="url(#path-8-inside-4_1868_300)"/>
          </svg>
          </div>
          <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Search</div>
      </li> 
      </ul>
    )
  }
  else if (nodeType ==='textBlock'
  ) {
    // other edge types, render other edge menu
    return (<></>)
  }
  
}

export default EdgeMenu