import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "cursive"],
        body: ["var(--font-body)", "sans-serif"],
      },
      colors: {
        sea: {
          50: "#eef8fb",
          100: "#d5eef4",
          200: "#a9dde9",
          300: "#72c4d9",
          400: "#3fa5c1",
          500: "#2688a6",
          600: "#226e8b",
          700: "#215a72",
          800: "#224b5e",
          900: "#204051",
        },
        sand: {
          50: "#fdfaf3",
          100: "#faf1dd",
          200: "#f4e0b6",
          300: "#eccb87",
          400: "#e4b45a",
        },
        blush: {
          200: "#ffd6e0",
          300: "#ffb3c7",
          400: "#ff89aa",
          500: "#f76090",
        },
      },
      keyframes: {
        bob: {
          "0%, 100%": { transform: "translateY(0) rotate(-3deg)" },
          "50%": { transform: "translateY(-12px) rotate(3deg)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        // A letter unrolling like a scroll as it reaches the top of the stack:
        // curled shut at the top edge, then unfurling down into full view.
        unravel: {
          "0%": {
            transform: "perspective(1400px) rotateX(-82deg) scaleY(0.4)",
            opacity: "0",
          },
          "55%": { opacity: "1" },
          "100%": {
            transform: "perspective(1400px) rotateX(0deg) scaleY(1)",
            opacity: "1",
          },
        },
      },
      animation: {
        bob: "bob 6s ease-in-out infinite",
        float: "float 4s ease-in-out infinite",
        unravel: "unravel 640ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
