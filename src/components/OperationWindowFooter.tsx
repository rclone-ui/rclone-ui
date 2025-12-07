export default function OperationWindowFooter({ children }: { children: React.ReactNode }) {
    return (
        <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-divider dark:border-neutral-500/20 bg-content3/60 dark:bg-neutral-900/70 backdrop-blur-lg">
            {children}
        </div>
    )
}
