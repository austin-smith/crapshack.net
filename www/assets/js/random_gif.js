// Array of GIFs and their alt text
const gifs = [
    { src: "images/stuckers/blinky.gif", alt: "the franchise" },
    { src: "images/stuckers/robot.gif", alt: "stupid robot" },
    { src: "images/stuckers/popcorn.gif", alt: "popcorn | opus" },
    { src: "images/stuckers/spiral.gif", alt: "obey" }
];

// Function to get a random GIF
function getRandomGif() {
    const randomIndex = Math.floor(Math.random() * gifs.length);
    return gifs[randomIndex];
}

// Get the random GIF and update the img element
const randomGif = getRandomGif();
const imgElement = document.getElementById("random-gif");
imgElement.src = randomGif.src;
imgElement.alt = randomGif.alt;
imgElement.title = randomGif.alt;