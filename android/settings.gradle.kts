// DSH Mobile — Android WebView wrapper.
// Gradle settings (Kotlin DSL). The Gradle wrapper JAR is intentionally NOT committed:
// CI provisions Gradle 8.9 itself, and local users can either install Gradle 8.9
// or run `gradle wrapper --gradle-version 8.9` once to generate the wrapper locally.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "dsh-mobile-android"
include(":app")
