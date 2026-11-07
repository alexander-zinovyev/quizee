# Quizee

Quizee brings the experience of a pub quiz online. A host leads teams through a series of themed rounds, and teammates work together to answer each question.

## About

Quizee is for casual players who enjoy gathering around a table for a pub quiz or a game of «Що? Де? Коли?». Players can join from different places and still talk through a clue, compare guesses, and find out together whether they got it right.

The host builds a quiz or loads a prepared quiz pack. Each round has a theme of its own. One might ask teams to identify films from stills, while another might have them name songs from audio clips. The host sets the pace, choosing when to offer another clue, reveal an answer, or move on to the next round. Teams submit a shared answer to each question and can see how each round contributed to their final score.

## Features

- **Team play.** Teammates can talk through clues over voice and video, use their team chat, and submit a shared answer. Other teams can have their own discussions at the same time, and everyone can use the room chat between rounds.
- **Live hosting.** The host sets the pace. They decide when to show a question, give teams another clue, reveal the answer, or move on to the next round.
- **Scoring and standings.** Hosts grade written answers and can adjust points. Image, color, and sorting rounds support automatic scoring, and text rounds can offer a double-or-nothing wager. After the game, teams can see where they placed and which questions earned them points.
- **Sorting rounds.** Teams arrange text or media items into a shared order while other rounds continue. Each item in its correct position earns one point. The host closes submissions and reveals the correct order separately.
- **Quiz builder.** Hosts can write themed rounds, add images, audio, or video, and preview questions before game night. They can save the quiz as a reusable pack or load an existing pack to edit it.
- **Game history.** Players can revisit published games, compare results round by round, and follow their performance across quiz nights.

## Round formats

| Format | How it plays |
| --- | --- |
| **Text** | Teams write an answer. The host can present the question and reveal the answer in stages, using text, images, audio, or video. |
| **Image matching** | Teams match pictures to prompts, such as pairing film stills with movie titles. |
| **Multi-step** | Teams get one clue at a time. An early guess can be worth more points, so teams have to weigh answering now against waiting for another clue. |
| **Color matching** | Teams adjust part of an image to match a color from memory, such as the red in a familiar logo. The closer the match, the better the score. During answer reveal, teams can compare the original, their own submission, and a gallery of other teams' submissions. |
| **Sorting** | Teams arrange text or media items according to a criterion, with one point for each correct position. The list can stay open alongside other rounds. |

Sorting packs use the existing stage format for item text and media. See [sorting pack authoring](docs/sorting-rounds.md) for the JSON format.

## Firestore access policy

[`firestore.rules`](firestore.rules) tracks the deployed room access policy. Room members can use room chat; teams and the host can use team chat. Teams can read and write their own live round data, and the host can manage round data. Questions and images become readable when a round is no longer scheduled. Correct answers and all teams' frozen submissions become readable to room members when the round closes, independently of the host's presentation reveal. The player UI controls when those results appear.

Server answer endpoints enforce their own input, lock, and round-lifecycle validation. These checks do not restrict the direct Firestore writes permitted by the rules. `npm run test:rules` exercises both the access policy and server validation in the Firestore emulator; CI runs it on pushes and pull requests. CI does not deploy rules to production.
