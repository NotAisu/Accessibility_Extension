<script>
  let password = '';
</script>

<form>
  <label>Password <input bind:value={password} type="password" autocomplete="off" /></label>
  <button type="button" style="width:20px;height:20px" aria-label="Show password">*</button>
  <button type="submit" style="width:20px;min-width:48px;height:40px">Log in</button>
</form>
