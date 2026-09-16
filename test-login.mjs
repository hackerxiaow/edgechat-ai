const res = await fetch("https://chat.cnz.kdns.fr/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "yxy.@990524gdg" })
});
console.log(res.status);
console.log(await res.text());
