import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#3b5b92", dark: "#2c4570", light: "#eef3fb" } },
    },
  },
  plugins: [],
};
export default config;
