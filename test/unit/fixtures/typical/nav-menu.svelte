<script>
  let { items = [], user = null, onLogout } = $props();
  let open = $state(false);
  let query = $state('');

  const filtered = $derived(items.filter(item => item.label.toLowerCase().includes(query.toLowerCase())));

  function toggle() {
    open = !open;
  }
</script>

<header class="site-header">
  <a href="/" class="logo"><img src="/logo.svg" alt="Home"></a>
  <button type="button" aria-expanded={open} aria-controls="menu" onclick={toggle}>Menu</button>
  <nav id="menu" class:open aria-label="Main">
    <input type="search" bind:value={query} placeholder="Filter">
    <ul>
      {#each filtered as item (item.href)}
        <li>
          <a href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</a>
          {#if item.children}
            <ul>
              {#each item.children as child}
                <li><a href={child.href}>{child.label}</a></li>
              {/each}
            </ul>
          {/if}
        </li>
      {:else}
        <li>No matches</li>
      {/each}
    </ul>
  </nav>
  {#if user}
    <div class="user">
      <img src={user.avatar}>
      <span>{user.name}</span>
      <div class="logout" onclick={onLogout}>Log out</div>
    </div>
  {:else}
    <a href="/login">Log in</a>
  {/if}
  <a href="/cart"></a>
</header>

<section class="banner" style="color: #777777; background: #ffffff">
  <h2>Free delivery this week</h2>
  <p>On all orders over €50.</p>
  <marquee>Limited offer</marquee>
</section>

<style>
  .site-header { display: flex; gap: 1rem; align-items: center; }
  nav:not(.open) { display: none; }
  .logout { cursor: pointer; }
</style>
