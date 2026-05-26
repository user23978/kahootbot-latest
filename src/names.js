const firstNames = [
  "Aileen", "Bryant", "Bridget", "Guillermo", "Jordan", "Tomas", "Julia", "Lawson", "Melanie", "Idris", 
  "Gracelyn", "Gary", "Karen", "Jamison", "Lauren", "Johnny", "Hadley", "Kameron", "Lyra", "Dilan", 
  "Brinley", "Giovanni", "Alexia", "Aries", "Catalina", "Baker", "Kairi", "Rowen", "Mckenna", "Amos", 
  "Sariyah", "Levi", "Virginia", "Bryce", "Royal", "Shane", "Tiffany", "Kameron", "Averie", "Tripp", 
  "Carmen", "Noel", "Jaelynn", "Grant", "Luella", "Marcellus", "Reese", "Dexter", "Savanna", "Asa", 
  "Charley", "Foster", "Gemma", "Mohammed", "Nadia", "Blaze", "Harleigh", "Zane", "Alexa", "John", 
  "Carmen", "Beckham", "Priscilla", "Alberto", "Mina", "Carl", "Armani", "Bo", "Arianna", "Axl", 
  "Nora", "Layton", "Sariyah", "Drake", "Charlie", "Mohamed", "Ana", "Jesse", "Talia", "Kade", "Journi", 
  "Calum", "Luna", "Lian", "Elle", "Kamden", "Ophelia", "Louis", "Olivia", "Bear", "Zoey", "Myles", 
  "Rylie", "Cal", "Erin", "Erick", "Artemis", "Jamal", "Dayana", "Mason", "Jaylin", "Marcel", "Ariya", 
  "Jaiden", "Sloan", "Justice", "Scarlette", "Eithan", "Kelsey", "Andres", "Hayden", "Bo", "Zhuri", 
  "Abdiel", "Jaylee", "Killian", "Winnie", "Hudson", "Selena", "Isaias", "Isabella", "Kasen", "Chelsea", 
  "Daxton", "Blaire", "Canaan", "Halle", "Matthias", "Johanna", "Paxton", "Ruth", "Stetson", "Amanda", 
  "Isaac", "Anahi", "Rowen", "Ariya", "Fox", "Ramona", "Seth", "Alaiya", "Eliezer", "Vivian", "Alistair", 
  "Elise", "Braylen", "Carly", "Aziel", "Sylvie", "Zion", "Maryam", "Soren", "Amayah", "Joe", "Jocelyn", 
  "Demetrius", "Madilynn", "Wilder", "Giovanna", "Gabriel", "Adalee", "Fabian", "Emerie", "Kingsley", 
  "Amalia", "Jamari", "Bonnie", "Emmanuel", "Erin", "Edison", "Cassidy", "Felipe", "June", "Darren", 
  "Raquel", "Jeremiah", "Addilyn", "Banks", "Izabella", "Princeton", "Estelle", "Griffin", "Tiana", 
  "Hakeem", "Zoe", "Kenzo", "Jaylah", "Hugh", "Luisa", "Theodore", "Kinley", "Roy", "Jayda", "Nasir", 
  "Chanel", "Bobby", "Nellie", "Maverick", "Annika", "Rogelio"
];

const lastNames = [
  "Yu", "Stafford", "Hebert", "Gill", "Baxter", "Coleman", "Becker", "Sullivan", "Noble", "Stanley", 
  "Calhoun", "Weeks", "Farmer", "Lawrence", "Erickson", "Gonzales", "Fowler", "Patrick", "Conrad", "Hale", 
  "Graham", "Snow", "Dunlap", "Stone", "Hartman", "Morse", "Pratt", "Howell", "Marks", "Frederick", 
  "Moore", "Hoover", "Guerrero", "Jacobson", "Ball", "Durham", "Fowler", "Rivas", "Ingram", "Christensen", 
  "Paul", "Hinton", "Armstrong", "Reyna", "Blackwell", "Woods", "Shaffer", "Roy", "Ibarra", "Kitler", 
  "McPherson", "Hart", "Bridges", "Mack", "Fitzpatrick", "Rowland", "Lynch", "Willis", "Clark", "Christensen", 
  "Santiago", "Trevino", "Arroyo", "Atkins", "Esparza", "Camacho", "Marsh", "Wallace", "Strong", "Robinson", 
  "Huynh", "Frederick", "Sparks", "Griffin", "Santana", "Harper", "Vazquez", "Neal", "Barker", "Humphrey", 
  "Finley", "Wilson", "O’Donnell", "Graves", "Rowe", "Chang", "Singh", "Smith", "Rivers", "Young", "Moreno", 
  "Steele", "Lim", "Escobar", "Luna", "Vo", "Benton", "Copeland", "Hernandez", "Bentley", "O’Neill", "Flowers", 
  "Baldwin", "Mathews", "Benitez", "Hickman", "Bernal", "McBride", "Alvarado", "Day", "Marsh", "Hendrix", 
  "Andrade", "Esquivel", "Cohen", "Bullock", "Adams", "Greene", "Zhang", "Miller", "Saunders", "Allison", 
  "Park", "Glenn", "Donaldson", "Medrano", "Gill", "Villa", "Bishop", "Ray", "Clarke", "Blake", "Hill", 
  "Christian", "Pratt", "Flowers", "Crane", "Esparza", "Manning", "Orr", "Rowland", "Powell", "Andersen", 
  "Duncan", "Frank", "Monroe", "Norman", "Whitehead", "Woods", "Buchanan", "Suarez", "Xiong", "Stephenson", 
  "Gilbert", "Valentine", "Ibarra", "Rosales", "Johns", "Nguyen", "Hurst", "Cross", "Yoder", "Galvan", 
  "Wilkins", "Valenzuela", "Poole", "Chen", "Escobar", "Collier", "Barber", "Lucero", "Mills", "Montes", 
  "Huber", "Howard", "Sherman", "Cortes", "Sutton", "O’Connor", "Lowery", "Greene", "Parrish", "Estes", 
  "Green", "Ballard", "Beasley", "Macdonald", "Branch", "Thompson", "Rosales", "Roth", "Wall", "Deleon", 
  "Gilmore", "Pennington", "Enriquez", "Carter", "McFarland", "Tang", "Wall"
];

export function generateRandomName() {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${firstName} ${lastName}`;
}
