const { heroui } = require('@heroui/react')

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
        './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            keyframes: {
                'fade-in-up': {
                    '0%': { opacity: '0', transform: 'translateY(24px)' },
                    '60%': { opacity: '1' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
            },
            animation: {
                'fade-in-up': 'fade-in-up 900ms cubic-bezier(0.22, 1, 0.36, 1)',
            },
        },
    },
    plugins: [heroui()],
}
