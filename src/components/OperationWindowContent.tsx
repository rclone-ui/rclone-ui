import { cn } from '@heroui/react'
import { platform } from '@tauri-apps/plugin-os'

export default function OperationWindowContent({
    children,
    className,
}: { children: React.ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                'flex flex-col flex-1 w-full max-w-3xl gap-6 pt-10 mx-auto',
                platform() === 'macos' && 'pt-14',
                className
            )}
        >
            {children}
        </div>
    )
}
