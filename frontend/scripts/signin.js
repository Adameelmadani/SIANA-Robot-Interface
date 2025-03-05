document.addEventListener('DOMContentLoaded', () => {
  const signinForm = document.getElementById('signin-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');

  // Validate email format
  function isValidEmail(email) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailPattern.test(email);
  }

  // Clear error messages
  function clearErrors() {
      emailError.textContent = '';
      passwordError.textContent = '';
  }

  signinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearErrors();
      
      let isValid = true;
      
      // Validate email
      if (!emailInput.value.trim()) {
          emailError.textContent = 'Email is required';
          isValid = false;
      } else if (!isValidEmail(emailInput.value)) {
          emailError.textContent = 'Please enter a valid email address';
          isValid = false;
      }
      
      // Validate password
      if (!passwordInput.value) {
          passwordError.textContent = 'Password is required';
          isValid = false;
      }
      
      if (isValid) {
          // Here you would typically send the data to your backend
          console.log('Form is valid, submitting...');
          console.log(`Email: ${emailInput.value}`);
          console.log(`Password: ${passwordInput.value}`);
          
          // Mock authentication - replace with actual authentication logic
          // For example, fetch('/api/login', { method: 'POST', body: JSON.stringify({...}) })
          
          alert('Sign-in successful! (This is just a placeholder - implement actual authentication)');
          
          // Redirect after successful login
          // window.location.href = 'dashboard.html';
      }
  });
});