<template>
    <main class="py-5 space-y-8 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-0">
        <div class="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)_40vh]">
            <div class="order-2 card bg-base-200 lg:order-1 lg:min-h-0 lg:min-w-0">
                <div class="card-body">
                    <span>Active playlist selector here</span>
                    <h3 class="text-lg">Channel name</h3>
                    <h2 class="text-2xl font-bold">Program title</h2>
                    <p class="text-base-content/70">20:00-21:00 · 60 min</p>
                    <p class="text-base-content/70">
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
                    </p>
                </div>
            </div>

            <video controls playsinline class="order-1 bg-black card bg-base-200 lg:order-2 lg:aspect-video lg:h-full rounded-xl" aria-label="Channel video" />

            <div class="order-3 card bg-base-200 lg:col-span-2 lg:min-h-0 lg:overflow-y-auto">
                <div class="card-body">
                    <h2 class="text-xl font-bold">Program Guide/Channel list</h2>
                </div>
            </div>
        </div>
    </main>
</template>
