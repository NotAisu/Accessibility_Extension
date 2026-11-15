<template>
  <form @submit.prevent="submit">
    <label>Password <input v-model="password" type="password" autocomplete="off"></label>
    <label>Mode <input type="password" :autocomplete="mode"></label>
    <button type="button" class="w-5 h-5" aria-label="Show password">*</button>
    <button type="submit" class="w-24 h-10">Log in</button>
  </form>
</template>

<script setup>
import { ref } from 'vue';
const password = ref('');
const mode = 'off';
function submit() {}
</script>
