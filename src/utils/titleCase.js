const titleCase = (str) => {
  return str
    .toLowerCase()
    .split(" ")
    .map(function (word) {
      return word.replace(word[0], word[0].toUpperCase());
    })
    .join(" ");
};

const removeWhitespace = (str) => {
  return str.replace(/\s+/g, "");
};

export { titleCase, removeWhitespace };
