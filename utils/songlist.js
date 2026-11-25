import prisma from "../src/lib/prisma.js";

let songs = [];

const loadSong = async () => {
  const data = await prisma.songList.findMany();
  songs = data.map((entry) => entry.songName);

  console.log("Loaded songs:", songs);
  return songs;
};

const getSong = () => {
  return songs;
};

const updateSongList = async () => {
  songs = await loadSong();
};

export { loadSong, getSong, updateSongList };
