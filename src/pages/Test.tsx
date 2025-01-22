import { useStore } from '../../lib/store'

// const store = new LazyStore('store.json')

function Test() {
    const count = useStore((state) => state.count)
    const increment = useStore((state) => state.increment)

    // useEffect(() => {
    //     console.log('Test')

    //     let unsubscribe: () => void

    //     store
    //         .onChange(async (key, value) => {
    //             console.log('key', key)
    //             console.log('value', value)

    //             const v = await store.entries()
    //             console.log('v', v)
    //         })
    //         .then((uFn) => {
    //             unsubscribe = uFn
    //         })

    //     return () => {
    //         if (unsubscribe) {
    //             unsubscribe()
    //         }
    //     }
    // }, [])

    return (
        <main className="container bg-blue-500">
            <div className="flex flex-col">
                <h1>Rclone UI</h1>
                <button
                    onClick={() => {
                        increment()
                    }}
                    type="button"
                >
                    Increment Zustand
                </button>

                <p>{count}</p>
            </div>
        </main>
    )
}

export default Test
