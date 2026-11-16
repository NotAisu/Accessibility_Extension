<template>
  <form @submit.prevent="submit">
    <label>Email <input type="email" autocomplete="emal"></label>
    <label>Name <input autocomplete="given-name"></label>
    <label>Phone <input type="tel" autocomplete="work tel"></label>
    <label>Street <textarea autocomplete="shipping street-address"></textarea></label>
    <label>Mode <input :autocomplete="mode"></label>
    <label>Country <select autocomplete="county"><option>DE</option></select></label>
    <button type="submit">Send</button>
  </form>
</template>

<script setup>
const mode = 'emal';
function submit() {}
</script>
