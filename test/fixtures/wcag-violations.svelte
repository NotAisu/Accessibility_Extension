<script>
  import { onMount } from 'svelte';

  let showModal = false;
  let formData = { name: '', email: '' };
  let dynamicMessage = 'Initial content';
  let autoFocusInput;

  // Auto-focus without user control (WCAG 3.2.1)
  onMount(() => {
    autoFocusInput?.focus();
    
    // Timeout without user control (WCAG 2.2.1)
    setTimeout(() => {
      alert('Session expired');
    }, 30000);
    
    // Dynamic content changes without announcement
    setTimeout(() => {
      dynamicMessage = 'Content updated without screen reader notification';
    }, 5000);
  });

  function handleClick() {
    alert('clicked');
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Form submission without proper validation
  }

  // Context change on input (WCAG 3.2.2)
  function handleSelectChange(e) {
    if (e.target.value) {
      window.location.href = e.target.value;
    }
  }
</script>

<div>
  <!-- Missing main landmark -->
  <header>
    <h1>WCAG Violations in Svelte</h1>
    <!-- Navigation without proper markup -->
    <div class="nav">
      <a href="/">Home</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </div>
  </header>

  <!-- 1.1.1 Non-text Content -->
  <section>
    <h2>Image Accessibility Issues</h2>
    <img src="/logo.svg" />
    <img src="/chart.png" alt="" />
    <img src="/icon.png" alt="icon" />
    <!-- Decorative image with unnecessary alt -->
    <img src="/decoration.jpg" alt="Beautiful decorative pattern" />
    
    <!-- Canvas without alternative -->
    <canvas width="300" height="200" id="data-chart">
      <!-- Missing fallback content -->
    </canvas>
  </section>

  <!-- 1.3.1 Info and Relationships -->
  <section>
    <h2>Semantic Structure Issues</h2>
    
    <!-- Wrong heading hierarchy -->
    <h1>Subsection Title</h1>
    <h4>Should be h3</h4>
    
    <!-- Non-semantic interactive elements -->
    <div on:click={handleClick} class="fake-button">
      Submit Form
    </div>
    
    <span on:click={() => showModal = true} class="clickable">
      Open Modal
    </span>

    <!-- Table without proper headers -->
    <table>
      <tr>
        <td>Name</td>
        <td>Age</td>
        <td>Department</td>
      </tr>
      <tr>
        <td>John Doe</td>
        <td>30</td>
        <td>Engineering</td>
      </tr>
    </table>

    <!-- List without proper markup -->
    <div>
      <div>• First item</div>
      <div>• Second item</div>
      <div>• Third item</div>
    </div>
  </section>

  <!-- 1.4.3 Contrast violations -->
  <section>
    <h2>Color Contrast Issues</h2>
    <p style="color: #777; background: #999;">
      Low contrast text
    </p>
    <button style="background: #ccc; color: #ddd;">
      Poor Contrast Button
    </button>
  </section>

  <!-- 2.1.1 Keyboard accessibility -->
  <section>
    <h2>Keyboard Access Issues</h2>
    <div tabindex="0" on:click={() => console.log('clicked')}>
      Focusable div without proper role
    </div>
    
    <!-- Tab order issues -->
    <input type="text" tabindex="5" placeholder="Third input" />
    <input type="text" tabindex="2" placeholder="First input" />
    <input type="text" tabindex="1" placeholder="Second input" />
  </section>

  <!-- 2.2.2 Pause, Stop, Hide -->
  <section>
    <h2>Animation Control Issues</h2>
    <div class="blinking">Blinking text without controls</div>
    <video autoplay loop muted>
      <source src="/background-video.mp4" type="video/mp4" />
    </video>
  </section>

  <!-- 2.4.4 Link Purpose -->
  <section>
    <h2>Link Purpose Issues</h2>
    <a href="/page1">Click here</a>
    <a href="/info">More</a>
    <a href="/details">Read more</a>
    <a href="#"></a>
    <a href="/download.pdf">Download</a>
  </section>

  <!-- 2.4.7 Focus Visible -->
  <section>
    <h2>Focus Indicator Issues</h2>
    <button style="outline: none;">
      Button without focus outline
    </button>
    <a href="#" style="outline: none;">
      Link without focus
    </a>
  </section>

  <!-- 2.5.8 Target Size -->
  <section>
    <h2>Target Size Issues</h2>
    <button style="width: 10px; height: 10px;">
      <!-- Too small button -->
    </button>
    <a 
      href="#" 
      style="display: inline-block; width: 15px; height: 15px;"
    >
      ×
    </a>
  </section>

  <!-- 3.2.2 On Input -->
  <section>
    <h2>Context Change Issues</h2>
    <select on:change={handleSelectChange}>
      <option value="">Select a page</option>
      <option value="/page1">Page 1</option>
      <option value="/page2">Page 2</option>
    </select>
  </section>

  <!-- 3.3.2 Labels or Instructions -->
  <section>
    <h2>Form Label Issues</h2>
    <form on:submit={handleSubmit}>
      <input 
        type="text" 
        placeholder="Enter your name"
        bind:this={autoFocusInput}
      />
      <input type="email" />
      <textarea placeholder="Your message"></textarea>
      
      <!-- Radio buttons without fieldset -->
      <div>
        <input type="radio" name="gender" value="male" /> Male
        <input type="radio" name="gender" value="female" /> Female
        <input type="radio" name="gender" value="other" /> Other
      </div>
      
      <button type="submit">Submit</button>
    </form>
  </section>

  <!-- 4.1.2 Name, Role, Value -->
  <section>
    <h2>Interactive Element Issues</h2>
    <button></button>
    <button>?</button>
    <input type="submit" />
    
    <select>
      <option>Option 1</option>
      <option>Option 2</option>
    </select>
  </section>

  <!-- ARIA Misuse -->
  <section>
    <h2>ARIA Issues</h2>
    <div aria-hidden="true" tabindex="0">
      Hidden but focusable content
    </div>
    
    <button 
      aria-label="Save file" 
      aria-describedby="nonexistent-id"
    >
      Save
    </button>
    
    <img src="/icon.png" alt="Icon" aria-label="Icon" />
    
    <div role="button" aria-pressed="maybe">
      Invalid ARIA value
    </div>

    <ul role="menu">
      <li>Not a proper menuitem</li>
      <li>Another improper item</li>
    </ul>
  </section>

  <!-- Color-only information -->
  <section>
    <h2>Color Dependency Issues</h2>
    <p>
      Required fields are marked in <span style="color: red;">red</span>
    </p>
    <p>
      Valid fields are shown in <span style="color: green;">green</span>
    </p>
  </section>

  <!-- Modal without proper focus management -->
  {#if showModal}
    <div class="modal-overlay" on:click={() => showModal = false}>
      <div class="modal">
        <h3>Modal Title</h3>
        <p>Modal content without proper focus management</p>
        <button on:click={() => showModal = false}>Close</button>
      </div>
    </div>
  {/if}

  <!-- Missing skip links -->
  <!-- No skip navigation present -->

  <!-- Dynamic content without announcement -->
  <div id="dynamic-content">
    {dynamicMessage}
  </div>

  <!-- Improper iframe usage -->
  <iframe src="/widget" title="" />
  <iframe src="/content" />

  <!-- Missing form validation -->
  <section>
    <h2>Form Validation Issues</h2>
    <input 
      type="text" 
      style="border: 2px solid red;"
      aria-invalid="true"
    />
    <span style="color: red;">Error message not associated</span>
  </section>

  <!-- Footer without proper landmark -->
  <div class="footer">
    <p>&copy; 2025 Company Name</p>
  </div>
</div>

<style>
  /* Color-only information (WCAG 1.4.1) */
  .error { color: red; }
  .success { color: green; }

  /* Insufficient contrast (WCAG 1.4.3) */
  .low-contrast { color: #777; background: #999; }

  /* Moving content without pause control (WCAG 2.2.2) */
  @keyframes blink { 
    0% { opacity: 1; } 
    50% { opacity: 0; } 
    100% { opacity: 1; } 
  }
  .blinking { animation: blink 1s infinite; }

  /* Focus not visible (WCAG 2.4.7) */
  button:focus { outline: none; }

  /* Navigation styling without semantic structure */
  .nav {
    display: flex;
    gap: 1rem;
  }

  .nav a {
    text-decoration: none;
    padding: 0.5rem;
  }

  /* Fake button styling */
  .fake-button {
    background: #007cba;
    color: white;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 4px;
    display: inline-block;
  }

  .clickable {
    cursor: pointer;
    text-decoration: underline;
    color: blue;
  }

  /* Modal styling */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .modal {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    max-width: 500px;
    width: 90%;
  }

  .footer {
    margin-top: 2rem;
    padding: 1rem;
    background: #f5f5f5;
    text-align: center;
  }

  /* Table styling */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1rem 0;
  }

  td {
    border: 1px solid #ddd;
    padding: 0.5rem;
  }

  /* Form styling */
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 400px;
  }

  input, textarea, select {
    padding: 0.5rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  button {
    padding: 0.5rem 1rem;
    background: #007cba;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  /* Section styling */
  section {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid #eee;
    border-radius: 4px;
  }

  h2 {
    color: #333;
    border-bottom: 2px solid #007cba;
    padding-bottom: 0.5rem;
  }
</style>
