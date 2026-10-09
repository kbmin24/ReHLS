<!-- filepath: /config/ReHLS/client/src/views/404.vue -->
<template>
  <main class="login-background grid min-h-[100dvh] place-items-center px-5 py-10">
    <section
      aria-labelledby="not-found-title"
      class="card w-full max-w-md border border-base-content/10 bg-base-200/65 shadow-2xl backdrop-blur-xl"
    >
      <div class="card-body items-center gap-6 p-7 text-center sm:p-9">
        <img
          src="../assets/ReHLS_logo_full.png"
          alt="ReHLS"
          class="w-full"
        />
        <h1 id="not-found-title" class="text-3xl font-bold">
          404 Not Found
        </h1>
        <RouterLink to="/" custom v-slot="{ navigate }">
            <button @click="navigate" routerLink="/" class="btn btn-primary w-full" role="link">
                Return to Home
            </button>
        </RouterLink>
      </div>
    </section>
  </main>
  <div class="image-copyright text-sm text-base-content/50">Image by Antonio Cansino on Pixabay</div>
</template>

<style scoped>
.login-background {
  background: center / cover no-repeat
    url('../assets/antonio_cansino-cinema-5069314_1920.jpg');
}

.image-copyright {
  position: fixed;
  bottom: 1rem;
  right: 1.5rem;
}
</style>