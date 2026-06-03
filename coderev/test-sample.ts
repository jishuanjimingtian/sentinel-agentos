function getData(id: any) {
  const apiKey = "sk-1234567890abcdef";
  console.log("getting data...");
  // TODO: handle error
  return fetch("https://api.example.com/data/" + id);
}
