import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import Home from './pages/Home'
import './global.css'
import { NextUIProvider } from '@nextui-org/react'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import Copy from './pages/Copy'
import Jobs from './pages/Jobs'
import Mount from './pages/Mount'
import Settings from './pages/Settings'
import Sync from './pages/Sync'
import Test from './pages/Test'

function forwardConsole(
    fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
    logger: (message: string) => Promise<void>
) {
    const original = console[fnName]
    console[fnName] = (message, ...args) => {
        original(message, ...args)
        logger(
            `${message} ${args?.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`
        )
    }
}

forwardConsole('log', trace)
forwardConsole('debug', debug)
forwardConsole('info', info)
forwardConsole('warn', warn)
forwardConsole('error', error)

const router = createBrowserRouter([
    {
        path: '/',
        element: <Home />,
    },
    {
        path: '/settings',
        element: <Settings />,
    },
    {
        path: '/sync',
        element: <Sync />,
    },
    {
        path: '/copy',
        element: <Copy />,
    },
    {
        path: '/mount',
        element: <Mount />,
    },
    {
        path: '/jobs',
        element: <Jobs />,
    },
    {
        path: '/test',
        element: <Test />,
    },
])

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <NextUIProvider>
            {/* <TauriWatcher /> */}
            <RouterProvider router={router} />
        </NextUIProvider>
    </React.StrictMode>
)
