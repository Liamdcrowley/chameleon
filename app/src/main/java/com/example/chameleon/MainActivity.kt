package com.example.chameleon

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.isSystemInDarkTheme
import org.json.JSONArray
import kotlin.random.Random

data class Topic(val name: String, val options: List<String>)

data class Game(
    val topic: Topic,
    val word: String,
    val chameleonIndex: Int
)

sealed interface Screen {
    object Setup : Screen
    object Game : Screen
    object Options : Screen
    data class Reveal(val playerIndex: Int) : Screen
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ChameleonApp() }
    }
}

@Composable
fun ChameleonApp() {
    val context = LocalContext.current
    val topics = remember { loadTopics(context) }
    val players = remember { mutableStateListOf<String>() }
    var screen by remember { mutableStateOf<Screen>(Screen.Setup) }
    var game by remember { mutableStateOf<Game?>(null) }
    var playerName by remember { mutableStateOf("") }

    val colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()

    MaterialTheme(colorScheme = colorScheme) {
        when (val current = screen) {
            Screen.Setup -> {
                SetupScreen(
                    players = players,
                    playerName = playerName,
                    onPlayerNameChange = { playerName = it },
                    onAddPlayer = {
                        val trimmed = playerName.trim()
                        if (trimmed.isNotEmpty()) {
                            players.add(trimmed)
                            playerName = ""
                        }
                    },
                    onRemovePlayer = { index ->
                        if (index in players.indices) {
                            players.removeAt(index)
                        }
                    },
                    onStartGame = {
                        val newGame = buildGame(players, topics)
                        if (newGame != null) {
                            game = newGame
                            screen = Screen.Game
                        }
                    },
                    canStart = players.isNotEmpty() && topics.isNotEmpty()
                )
            }
            Screen.Game -> {
                val currentGame = game
                if (currentGame == null) {
                    screen = Screen.Setup
                } else {
                    GameScreen(
                        topic = currentGame.topic.name,
                        players = players,
                        onPlayerClick = { index -> screen = Screen.Reveal(index) },
                        onBackToSetup = {
                            game = null
                            screen = Screen.Setup
                        },
                        onRestart = {
                            val newGame = buildGame(players, topics)
                            if (newGame != null) {
                                game = newGame
                            }
                        },
                        onShowOptions = { screen = Screen.Options }
                    )
                }
            }
            Screen.Options -> {
                val currentGame = game
                if (currentGame == null) {
                    screen = Screen.Setup
                } else {
                    OptionsScreen(
                        topic = currentGame.topic.name,
                        options = currentGame.topic.options,
                        onDone = { screen = Screen.Game }
                    )
                }
            }
            is Screen.Reveal -> {
                val currentGame = game
                if (currentGame == null) {
                    screen = Screen.Setup
                } else {
                    RevealScreen(
                        playerName = players.getOrNull(current.playerIndex) ?: "Player",
                        topic = currentGame.topic.name,
                        isChameleon = current.playerIndex == currentGame.chameleonIndex,
                        word = currentGame.word,
                        onDone = { screen = Screen.Game }
                    )
                }
            }
        }
    }
}

@Composable
fun SetupScreen(
    players: List<String>,
    playerName: String,
    onPlayerNameChange: (String) -> Unit,
    onAddPlayer: () -> Unit,
    onRemovePlayer: (Int) -> Unit,
    onStartGame: () -> Unit,
    canStart: Boolean
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Top
    ) {
        Text(
            text = "Chameleon",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = playerName,
            onValueChange = onPlayerNameChange,
            label = { Text("Player name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            Button(
                onClick = onAddPlayer,
                enabled = playerName.trim().isNotEmpty()
            ) {
                Text("Add Player")
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Players",
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(modifier = Modifier.height(8.dp))
        if (players.isEmpty()) {
            Text(
                text = "Add at least one player to start.",
                style = MaterialTheme.typography.bodyMedium
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 240.dp)
            ) {
                itemsIndexed(players) { index, name ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = name,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = { onRemovePlayer(index) }) {
                            Text("Remove")
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = onStartGame,
            enabled = canStart,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Start Game")
        }
        if (!canStart) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Add at least one player and make sure topics are available.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
fun GameScreen(
    topic: String,
    players: List<String>,
    onPlayerClick: (Int) -> Unit,
    onBackToSetup: () -> Unit,
    onRestart: () -> Unit,
    onShowOptions: () -> Unit
) {
    BackHandler(onBack = onBackToSetup)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Top
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onBackToSetup) {
                Text("Back to setup")
            }
            OutlinedButton(onClick = onRestart) {
                Text("New Game")
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Topic: $topic",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(8.dp))
        Button(
            onClick = onShowOptions,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Show Options (Landscape)")
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Pass the phone and tap your name to reveal your role.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(modifier = Modifier.height(16.dp))
        LazyColumn(modifier = Modifier.fillMaxWidth()) {
            itemsIndexed(players) { index, name ->
                Button(
                    onClick = { onPlayerClick(index) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Text(name)
                }
            }
        }
    }
}

@Composable
fun OptionsScreen(
    topic: String,
    options: List<String>,
    onDone: () -> Unit
) {
    BackHandler(onBack = onDone)
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
    val columns = if (isLandscape) 3 else 2
    val textStyle = if (isLandscape) {
        MaterialTheme.typography.titleLarge
    } else {
        MaterialTheme.typography.titleMedium
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onDone) {
                Text("Back to game")
            }
            Text(
                text = "All Options",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Topic: $topic",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium
        )
        if (!isLandscape) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Rotate to landscape for maximum visibility.",
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        if (options.isEmpty()) {
            Text(
                text = "No options available.",
                style = MaterialTheme.typography.bodyMedium
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(columns),
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                items(options) { option ->
                    OutlinedCard(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 72.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Text(
                                text = option,
                                style = textStyle,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun RevealScreen(
    playerName: String,
    topic: String,
    isChameleon: Boolean,
    word: String,
    onDone: () -> Unit
) {
    BackHandler(onBack = onDone)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Top,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Player: $playerName",
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Topic: $topic",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(24.dp))
        if (isChameleon) {
            Text(
                text = "You are the Chameleon",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
        } else {
            Text(
                text = "Your word",
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = if (word.isNotBlank()) word else "No word available",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
        }
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onDone,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Done")
        }
    }
}

fun loadTopics(context: Context): List<Topic> {
    return try {
        val json = context.assets.open("chameleon_topics.json")
            .bufferedReader()
            .use { it.readText() }
        val array = JSONArray(json)
        val topics = mutableListOf<Topic>()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            val topicName = obj.optString("topic", "Topic")
            val optionsArray = obj.optJSONArray("options")
            val options = mutableListOf<String>()
            if (optionsArray != null) {
                for (j in 0 until optionsArray.length()) {
                    val option = optionsArray.optString(j).trim()
                    if (option.isNotEmpty()) {
                        options.add(option)
                    }
                }
            }
            topics.add(Topic(topicName, options))
        }
        topics
    } catch (e: Exception) {
        emptyList()
    }
}

fun buildGame(players: List<String>, topics: List<Topic>): Game? {
    if (players.isEmpty() || topics.isEmpty()) return null
    val topic = topics.random()
    val word = if (topic.options.isNotEmpty()) topic.options.random() else ""
    val chameleonIndex = Random.nextInt(players.size)
    return Game(topic, word, chameleonIndex)
}
