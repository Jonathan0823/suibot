import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";

function buildHoyoActionRow() {
  const button1 = new ButtonBuilder()
    .setEmoji("<:genshinimpact:1324355501466849331> ")
    .setLabel("GI ")
    .setStyle(ButtonStyle.Link)
    .setURL(
      "https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481&hyl_auth_required=true&hyl_presentation_style=fullscreen&utm_source=share&utm_medium=link&utm_campaign=web",
    );

  const button2 = new ButtonBuilder()
    .setEmoji("<:hsr:1324355673567395921> ")
    .setLabel("HSR")
    .setStyle(ButtonStyle.Link)
    .setURL(
      "https://act.hoyolab.com/bbs/event/signin/hkrpg/e202303301540311.html?act_id=e202303301540311&bbs_auth_required=true&bbs_presentation_style=fullscreen&lang=en-us&utm_source=share&utm_medium=link&utm_campaign=web",
    );

  const button3 = new ButtonBuilder()
    .setEmoji("<:zenless:1324356078825377932> ")
    .setLabel("ZZZ")
    .setStyle(ButtonStyle.Link)
    .setURL(
      "https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html?act_id=e202406031448091&bbs_auth_required=true&bbs_presentation_style=fullscreen&lang=en-us&utm_source=share&utm_medium=link&utm_campaign=web",
    );

  return new ActionRowBuilder().addComponents(button1, button2, button3);
}

function buildHoyoEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle("Check In Yuk!")
    .setDescription("Pagii!! Jangan lupa sarapan dan check-in Hoyolab kamu ya~ 🍞☕")
    .setThumbnail(
      "https://play-lh.googleusercontent.com/azVwh1OazZcsq6ocxOzH4mccFgs3IP0-RTxlFsoIumIO28RbmNx2YP7PEsqNAyY0ck0=w240-h480-rw",
    )
    .setImage(
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRCLqlemXM4g15lAmQK4Fq-CML4MhsBh8fQDw&s",
    )
    .setFooter({ text: "Hari ini semangat ya! 💪" });
}

function buildWuwaEmbed(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle("Selamat Pagi!")
    .setDescription(
      "Waktunya grinding Rover!\n Jangan lupa untuk kelarin daily dan bantai-bantai echonya ya~ <:chixiayatta:1336876161803882586>",
    )
    .setImage(
      "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExYnltdjZtMzVldmF0YnY5emV2bndlZ2hoOHZsb2NwaWpkb3BpNmo1cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bBXf4upe13UNjpGiFu/giphy.gif",
    )
    .setFooter({ text: "Hari ini semangat ya! 💪" });
}

export { buildHoyoActionRow, buildHoyoEmbed, buildWuwaEmbed };
