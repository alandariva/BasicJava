
class Fibonacci {

    static int numInv = 0;

    //Iteration method
    static int fibIteration(int n) {
        numInv++;
        int x = 0; int y = 1; int z = 1;
        for (int i = 0; i < n; i++) {
            x = y;
            y = z;
            z = x + y;
        }
        return x;
    }

    //Recursive method
    static int fibRecursion(int  n) {
        numInv++;
        if ((n == 1) || (n == 0)) {
            return n;
        }
        return fibRecursion(n - 1) + fibRecursion(n - 2);
    }

    public static void main(String args[]) {
        int x = 0;
        for (; x < 10; x++) {
            System.out.println(fibRecursion(x));
        }

        for (; x < 30; x++) {
            System.out.println(fibIteration(x));
        }

        System.out.print(numInv);
    }

}
