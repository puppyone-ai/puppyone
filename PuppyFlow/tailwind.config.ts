import type { Config } from "tailwindcss";
import { withUt } from "uploadthing/tw";
 

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'jetbrains-mono': [
          'JetBrains Mono', 'monospace'
        ],
        'plus-jakarta-sans': [
          'Plus Jakarta Sans', 'sans-serif'
        ]
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      borderWidth: {
        3: '3px',
      },
      borderColor: {
        'sidebar-grey': "#3E3E41",
        'main-blue': "#4599DF",
        'main-orange': "#FFA73D",
        'main-red': "#F44336",
        'main-green': "#39BC66",
        'main-bright-blue': "#D7F3FF",
        'main-black-theme': "#252525",
        'main-grey': "#CDCDCD",
        'main-deep-grey': "#3E3E41"
      },
      backgroundColor: {
        'sidebar-grey': "#3E3E41",
        'main-black-theme': "#252525",
        'main-blue': "#4599DF",
        'main-orange': "#FFA73D",
        'main-red': "#F44336",
        'main-green': "#39BC66",
        'main-bright-blue': "#D7F3FF",
        'main-grey': "#CDCDCD",
        'main-deep-grey': "#3E3E41"
      },
      textColor: {
        'main-blue': "#4599DF",
        'main-orange': "#FFA73D",
        'main-red': "#F44336",
        'main-green': "#39BC66",
        'main-bright-blue': "#D7F3FF",
        'main-black-theme': "#252525",
        'main-grey': "#CDCDCD",
        'main-deep-grey': "#6D7177"
      },
      keyframes: {
        dragdown: {
          '0%': { height: "0px"},
          '100%': {maxHeight: "500px",
                   overflow: "visible"}
        },
        
        dragUp: {
          '0%': {maxHeight: "500px",
                  overflow: "visible"},
          '100%': {height: "0px"}
        }
      },
      animation: {
        dragdown: 'dragdown 0.1s ease-in-out forwards',
        dragUp: 'dragUp 0.1s ease-in-out backwards'
      },
      scale: {
        'inverse': 'var(--inverse-zoom)',
      }
    },
  },
  plugins: [],
};
export default withUt(config);


