<template>
  <section class="todos">
    <header>
      <h1>{{ title }}</h1>
      <form @submit.prevent="add">
        <label for="new-todo">New task</label>
        <input id="new-todo" v-model="draft" type="text" autocomplete="off">
        <button type="submit" :disabled="!draft.trim()">Add</button>
      </form>
    </header>
    <nav aria-label="Filter tasks">
      <button
        v-for="option in filters"
        :key="option.value"
        type="button"
        :aria-pressed="filter === option.value"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </nav>
    <ul class="todo-list">
      <li v-for="todo in visible" :key="todo.id" :class="{ done: todo.done }">
        <input :id="`todo-${todo.id}`" v-model="todo.done" type="checkbox">
        <label :for="`todo-${todo.id}`">{{ todo.text }}</label>
        <span class="delete" @click="remove(todo)">✕</span>
        <img :src="todo.avatar">
      </li>
    </ul>
    <p v-if="visible.length === 0" class="empty">Nothing to do.</p>
    <footer>
      <span>{{ remaining }} left</span>
      <a href="#" @click.prevent="clearDone">Clear done</a>
      <a :href="helpUrl"></a>
      <input v-model="search" placeholder="Search">
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

interface Todo {
  id: number;
  text: string;
  done: boolean;
  avatar: string;
}

const props = defineProps<{ title: string; helpUrl: string }>();
const todos = ref<Todo[]>([]);
const draft = ref('');
const search = ref('');
const filter = ref<'all' | 'open' | 'done'>('all');
const filters = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' }
] as const;

let nextId = 1;

function add() {
  const text = draft.value.trim();
  if (!text) return;
  todos.value.push({ id: nextId++, text, done: false, avatar: '/me.png' });
  draft.value = '';
}

function remove(todo: Todo) {
  todos.value = todos.value.filter(t => t !== todo);
}

function clearDone() {
  todos.value = todos.value.filter(t => !t.done);
}

const visible = computed(() => todos.value
  .filter(t => filter.value === 'all' || (filter.value === 'done') === t.done)
  .filter(t => t.text.toLowerCase().includes(search.value.toLowerCase())));
const remaining = computed(() => todos.value.filter(t => !t.done).length);
const title = computed(() => props.title);
</script>

<style scoped>
.todos { max-width: 40rem; margin: 0 auto; }
.done label { text-decoration: line-through; }
.delete { cursor: pointer; color: #c00; }
</style>
