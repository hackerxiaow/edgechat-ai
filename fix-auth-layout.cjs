const fs = require('fs');

function updatePage(path) {
  let content = fs.readFileSync(path, 'utf8');
  
  // Remove floating LanguageSwitch
  content = content.replace(/<LanguageSwitch class="login-language-switch" \/>\s*/, '');
  
  // Insert LanguageSwitch and structure inside login-card
  const replacement = `<div class="login-card">
      <div class="login-card-header">
        <LanguageSwitch class="login-language-switch" />
      </div>
      <div class="login-brand">
        <img class="login-logo" src="/logo.svg" alt="" width="64" height="64" />
        <div class="login-brand-text">
          <h1 class="login-title">{{ store.site.siteName }}</h1>`;
  
  content = content.replace(/<div class="login-card">\s*<div class="login-brand">\s*<img class="login-logo" src="\/logo\.svg" alt="" width="46" height="46" \/>\s*<div class="login-brand-text">\s*<h1 class="login-title">{{ store\.site\.siteName }}<\/h1>/, replacement);

  // For RegisterPage, adjust subtitle 
  content = content.replace(/<p class="login-subtitle">{{ t\('auth\.welcomeBack'\) }}<\/p>/g, `<p class="login-subtitle">{{ t('auth.welcomeBack') }}</p>`);

  fs.writeFileSync(path, content, 'utf8');
}

updatePage('frontend/src/pages/LoginPage.vue');
updatePage('frontend/src/pages/RegisterPage.vue');
console.log('Layout updated.');
