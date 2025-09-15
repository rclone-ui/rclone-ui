import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import Home from './pages/Home'
import './global.css'
import { HeroUIProvider } from '@heroui/react'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import Copy from './pages/Copy'
import Cron from './pages/Cron'
import Delete from './pages/Delete'
import Jobs from './pages/Jobs'
import Mount from './pages/Mount'
import Move from './pages/Move'
import Settings from './pages/Settings'
import Startup from './pages/Startup'
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
        path: '/startup',
        element: <Startup />,
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
        path: '/move',
        element: <Move />,
    },
    {
        path: '/delete',
        element: <Delete />,
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
        path: '/cron',
        element: <Cron />,
    },
    {
        path: '/test',
        element: <Test />,
    },
])

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <HeroUIProvider>
            {/* <TauriWatcher /> */}
            <RouterProvider router={router} />
        </HeroUIProvider>
    </React.StrictMode>
)
