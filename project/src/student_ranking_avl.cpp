#include <iostream>
#include <string>
using namespace std;
struct Student {
    int rollNo;
    string name;
    int marks;
    Student* left;
    Student* right;
    int height;
};
int height(Student* node) {
    if (node == NULL)
        return 0;
    return node->height;
}
int getBalance(Student* node) {
    if (node == NULL)
        return 0;
    return height(node->left) - height(node->right);
}
Student* createStudent(int rollNo, string name, int marks) {
    Student* newNode = new Student();
    newNode->rollNo = rollNo;
    newNode->name = name;
    newNode->marks = marks;
    newNode->left = NULL;
    newNode->right = NULL;
    newNode->height = 1;
    return newNode;
}
Student* rightRotate(Student* y) {
    Student* x = y->left;
    Student* temp = x->right;
    x->right = y;
    y->left = temp;
    y->height = max(height(y->left), height(y->right)) + 1;
    x->height = max(height(x->left), height(x->right)) + 1;
    return x;
}
Student* leftRotate(Student* x) {
    Student* y = x->right;
    Student* temp = y->left;
    y->left = x;
    x->right = temp;
    x->height = max(height(x->left), height(x->right)) + 1;
    y->height = max(height(y->left), height(y->right)) + 1;
    return y;
}
Student* insert(Student* root, int rollNo, string name, int marks) {

    if (root == NULL)
        return createStudent(rollNo, name, marks);

   if (marks < root->marks) {

        root->left = insert(root->left, rollNo, name, marks);

    }
    else if (marks > root->marks) {

        root->right = insert(root->right, rollNo, name, marks);

    }
    else {
        cout << "Duplicate marks not allowed!\n";
        return root;
    }

    root->height =
        1 + max(height(root->left), height(root->right));

    int balance = getBalance(root);


    if (balance > 1 && marks < root->left->marks)
        return rightRotate(root);

  
    if (balance < -1 && marks > root->right->marks)
        return leftRotate(root);


    if (balance > 1 && marks > root->left->marks) {

        root->left = leftRotate(root->left);

        return rightRotate(root);
    }

  
    if (balance < -1 && marks < root->right->marks) {

        root->right = rightRotate(root->right);

        return leftRotate(root);
    }

    return root;
}

void ranking(Student* root, int& rank) {

    if (root == NULL)
        return;

    ranking(root->right, rank);

    cout << rank << ". "
         << "Roll No: " << root->rollNo
         << " | Name: " << root->name
         << " | Marks: " << root->marks
         << endl;

    rank++;

    ranking(root->left, rank);
}


void searchStudent(Student* root, int rollNo) {

    if (root == NULL) {
        cout << "Student not found!\n";
        return;
    }

    if (root->rollNo == rollNo) {

        cout << "\nStudent Found!\n";
        cout << "Roll No : " << root->rollNo << endl;
        cout << "Name    : " << root->name << endl;
        cout << "Marks   : " << root->marks << endl;

        return;
    }

    searchStudent(root->left, rollNo);
    searchStudent(root->right, rollNo);
}


Student* findTopper(Student* root) {

    if (root == NULL)
        return NULL;

    while (root->right != NULL)
        root = root->right;

    return root;
}

int main() {

    Student* root = NULL;

    int choice;

    do {

        cout << "\n========== STUDENT MARKS RANKING SYSTEM ==========\n";
        cout << "1. Add Student\n";
        cout << "2. Display Ranking\n";
        cout << "3. Search Student\n";
        cout << "4. Find Topper\n";
        cout << "5. Exit\n";

        cout << "Enter your choice: ";
        cin >> choice;

        if (choice == 1) {

            int rollNo, marks;
            string name;

            cout << "Enter Roll No: ";
            cin >> rollNo;

            cout << "Enter Name: ";
            cin >> name;

            cout << "Enter Marks: ";
            cin >> marks;

            root = insert(root, rollNo, name, marks);

            cout << "Student added successfully!\n";
        }

        else if (choice == 2) {

            if (root == NULL) {
                cout << "No students available.\n";
            }
            else {

                int rank = 1;

                cout << "\n========== RANKING ==========\n";

                ranking(root, rank);
            }
        }

        else if (choice == 3) {

            int rollNo;

            cout << "Enter Roll No to search: ";
            cin >> rollNo;

            searchStudent(root, rollNo);
        }

        else if (choice == 4) {

            Student* topper = findTopper(root);

            if (topper == NULL) {

                cout << "No students available.\n";

            }
            else {

                cout << "\n========== TOPPER ==========\n";

                cout << "Roll No : " << topper->rollNo << endl;
                cout << "Name    : " << topper->name << endl;
                cout << "Marks   : " << topper->marks << endl;
            }
        }

        else if (choice == 5) {

            cout << "Program ended.\n";

        }

        else {

            cout << "Invalid choice!\n";
        }

    } while (choice != 5);

    return 0;
}
