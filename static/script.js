console.log("JavaScript file loaded successfully from the static folder!");

// Add a simple event to prove it's working
document.addEventListener('DOMContentLoaded', () => {
    const heading = document.querySelector('h1');
    heading.addEventListener('click', () => {
        alert('You clicked the heading!');
    });
});